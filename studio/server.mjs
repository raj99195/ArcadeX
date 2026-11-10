import express from 'express';
import dotenv from 'dotenv';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { validateBlueprint, validateSettings } from './shared.mjs';
import * as providers from './providers.mjs';

dotenv.config({ quiet: true });
const root = path.dirname(fileURLToPath(import.meta.url));
const directory = path.resolve(process.env.STUDIO_DATA_DIR || path.join(root, '../.studio-data'));
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const isId = id => typeof id === 'string' && idPattern.test(id);
const jobs = new Map();
let active = null;
const projectPath = id => {
  if (!isId(id)) throw Object.assign(new Error('Invalid project ID.'), { status: 400 });
  return path.join(directory, id, 'project.json');
};
async function write(project) {
  const target = projectPath(project.id);
  project.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(project));
  // Windows readers/antivirus can briefly hold a destination handle. Preserve
  // atomic replacement and retry sharing violations rather than truncating it.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(temp, target); break; }
    catch (e) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt >= 6) throw e; await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt)); }
  }
  return project;
}
async function read(id) {
  try { return JSON.parse(await fs.readFile(projectPath(id), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') throw Object.assign(new Error('Project not found.'), { status: 404 }); throw e; }
}
function snapshot(p, label) {
  p.versions ||= [];
  p.versions.unshift({ id: randomUUID(), label, at: new Date().toISOString(), blueprint: structuredClone(p.blueprint), code: p.code, assets: structuredClone(p.assets), notes: p.notes, checklist: p.checklist });
  p.versions = p.versions.slice(0, 10);
}
function ensureIdle(p) {
  if (active?.projectId === p.id || [...jobs.values()].some(j => j.projectId === p.id && j.status === 'queued')) throw Object.assign(new Error('Wait for this project’s generation job or cancel it before editing.'), { status: 409 });
}
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function assetFile(projectId, assetId, record) {
  if (!isId(assetId) || !record?.file || !/^[a-zA-Z0-9_.-]+$/.test(record.file)) fail('Invalid asset.', 404);
  return path.join(directory, projectId, 'assets', record.file);
}
async function persistJob(job) {
  const p = await read(job.projectId);
  p.job = { id: job.id, action: job.action, status: job.status, message: job.message, progress: job.progress, error: job.error || '', startedAt: job.startedAt };
  await write(p);
}
async function run(job) {
  active = job; job.status = 'running'; job.controller = new AbortController();
  const update = async (message, progress) => { job.message = message; job.progress = progress; await persistJob(job); };
  try {
    let p = await read(job.projectId);
    snapshot(p, `Before ${job.action}`); await write(p);
    await update('Preparing generation…', 0);
    if (job.action === 'plan') {
      const blueprint = await providers.plan(p, job.controller.signal);
      if (job.controller.signal.aborted) throw new Error('Generation cancelled.');
      p = await read(p.id); p.blueprint = blueprint; p.code = ''; p.assets = {}; p.notes = ''; p.checklist = [];
      await write(p); await update('Blueprint ready for review.', 100);
    } else if (job.action === 'build' || job.action === 'revise') {
      await update(job.action === 'revise' ? 'Applying your requested gameplay changes…' : 'Building the complete playable game…', 10);
      const result = await providers.build(p, job.change, job.controller.signal);
      if (job.controller.signal.aborted) throw new Error('Generation cancelled.');
      p = await read(p.id); p.code = result.code; p.notes = result.notes; p.checklist = result.checklist; await write(p);
      await update('Build ready. Open Preview and playtest.', 100);
    } else {
      const definitions = p.blueprint.assets.filter(a => job.assetId ? a.id === job.assetId : !p.assets[a.id]);
      for (let index = 0; index < definitions.length; index++) {
        if (job.controller.signal.aborted) throw new Error('Generation cancelled.');
        const definition = definitions[index];
        await update(`Generating ${definition.name} (${index + 1}/${definitions.length})…`, Math.round(index / Math.max(1, definitions.length) * 100));
        // A single-asset edit uses its current image as the reference.
        const old = p.assets[definition.id];
        let previous;
        if (job.assetId && old?.mime === 'image/png') previous = await fs.readFile(await assetFile(p.id, definition.id, old));
        const result = await providers.generateAsset({ ...definition, prompt: job.change || definition.prompt }, p.blueprint, previous, job.controller.signal);
        const file = `${definition.id}-${randomUUID()}.${result.extension}`;
        await fs.mkdir(path.join(directory, p.id, 'assets'), { recursive: true });
        await fs.writeFile(path.join(directory, p.id, 'assets', file), result.bytes);
        p = await read(p.id);
        p.assets[definition.id] = { file, mime: result.mime, source: 'generated', generatedAt: new Date().toISOString() };
        if (job.assetId && job.change) p.blueprint.assets = p.blueprint.assets.map(a => a.id === definition.id ? { ...a, prompt: job.change } : a);
        await write(p); // Checkpoint every asset; retry skips completed assets.
      }
      await update('Assets saved. Build the game or restart its preview.', 100);
    }
    job.status = 'completed';
  } catch (error) {
    job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
    job.error = error instanceof providers.ProviderError || error.message === 'Generation cancelled.' ? error.message : 'Generation failed. Check server logs and provider usage before retrying.';
    if (!(error instanceof providers.ProviderError)) console.error('[studio job]', error.message);
  } finally {
    await persistJob(job).catch(e => console.error('[studio persistence]', e.message));
    active = null;
    // Retain only bounded recent in-memory records; latest job is persisted per project.
    if (jobs.size > 100) for (const [id, j] of jobs) if (!['running', 'queued'].includes(j.status) && jobs.size > 100) jobs.delete(id);
    queueMicrotask(drain);
  }
}
function drain() { if (!active) { const job = [...jobs.values()].find(j => j.status === 'queued'); if (job) void run(job); } }

export async function createStudioApp() {
  await fs.mkdir(directory, { recursive: true });
  // Never silently repeat a potentially billed provider request after a crash.
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isId(entry.name)) continue;
    const p = await read(entry.name).catch(() => null);
    if (p?.job && ['queued', 'running'].includes(p.job.status)) { p.job.status = 'interrupted'; p.job.error = 'Server restarted. Saved assets are retained; check provider usage before retrying.'; await write(p); }
  }
  const app = express();
  app.disable('x-powered-by');
  app.use('/api/studio', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const expected = process.env.STUDIO_ACCESS_KEY;
    if (!expected || expected.length < 24) return res.status(503).json({ error: 'Set STUDIO_ACCESS_KEY to a random secret of at least 24 characters on the server.' });
    const provided = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const a = Buffer.from(provided), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return res.status(401).json({ error: 'Enter the private studio access key. This is not your OpenAI or ElevenLabs key.' });
    next();
  });
  app.use('/api/studio', express.json({ limit: '12mb' }));
  app.get('/api/studio/status', (req, res) => res.json({ ...providers.capabilities(), storage: 'server', workspace: 'private', worker: 'running' }));
  app.get('/api/studio/projects', async (req, res) => {
    const list = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isId(entry.name)) continue;
      const p = await read(entry.name).catch(() => null);
      if (p) list.push({ id: p.id, title: p.blueprint?.title || p.title, updatedAt: p.updatedAt, hasBuild: !!p.code, genre: p.settings.genre });
    }
    res.json(list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  });
  app.post('/api/studio/projects', async (req, res) => {
    const { prompt, settings } = req.body;
    if (typeof prompt !== 'string' || prompt.trim().length < 12 || prompt.length > 6000) fail('Describe your game in 12–6000 characters.');
    let validated;
    try { validated = validateSettings(settings); } catch (e) { fail(e.message); }
    const p = { id: randomUUID(), title: prompt.slice(0, 50), prompt: prompt.trim(), settings: validated, blueprint: null, code: '', assets: {}, versions: [], notes: '', checklist: [], createdAt: new Date().toISOString() };
    res.status(201).json(await write(p));
  });
  app.get('/api/studio/projects/:id', async (req, res) => res.json(await read(req.params.id)));
  app.put('/api/studio/projects/:id', async (req, res) => {
    const p = await read(req.params.id); ensureIdle(p);
    const { blueprint, code } = req.body;
    if (blueprint) { try { validateBlueprint(blueprint, p.settings); } catch (e) { fail(e.message); } }
    if (code !== undefined && (typeof code !== 'string' || code.length > 180000)) fail('Invalid game code.');
    if (code) { try { new Function(code); } catch (e) { fail(`JavaScript syntax error: ${e.message}`); } }
    snapshot(p, 'Manual edit');
    if (blueprint) p.blueprint = blueprint;
    if (code !== undefined) p.code = code;
    res.json(await write(p));
  });
  app.post('/api/studio/projects/:id/restore/:version', async (req, res) => {
    const p = await read(req.params.id); ensureIdle(p);
    const version = p.versions.find(v => v.id === req.params.version);
    if (!version) fail('Version not found.', 404);
    const restored = structuredClone(version); snapshot(p, 'Before restore');
    for (const key of ['blueprint', 'code', 'assets', 'notes', 'checklist']) p[key] = restored[key];
    res.json(await write(p));
  });
  app.get('/api/studio/projects/:id/assets/:asset', async (req, res) => {
    const p = await read(req.params.id), record = p.assets[req.params.asset];
    if (!record) fail('Asset not found.', 404);
    res.type(record.mime).send(await fs.readFile(await assetFile(p.id, req.params.asset, record)));
  });
  app.post('/api/studio/projects/:id/assets/:asset', async (req, res) => {
    const p = await read(req.params.id); ensureIdle(p);
    const definition = p.blueprint?.assets.find(a => a.id === req.params.asset);
    if (!definition) fail('Asset is not in the blueprint.', 404);
    const { data, mime } = req.body;
    const formats = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' };
    if (typeof data !== 'string' || !formats[mime] || (definition.kind === 'image' ? !mime.startsWith('image/') : !mime.startsWith('audio/'))) fail('Use PNG/JPEG/WebP images or MP3/WAV/OGG audio.');
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) fail('Uploads must be below 8 MB.');
    const file = `${definition.id}-${randomUUID()}.${formats[mime]}`;
    snapshot(p, `Replace ${definition.name}`);
    await fs.mkdir(path.join(directory, p.id, 'assets'), { recursive: true });
    await fs.writeFile(path.join(directory, p.id, 'assets', file), bytes);
    p.assets[definition.id] = { file, mime, source: 'uploaded' };
    res.json(await write(p));
  });
  app.post('/api/studio/projects/:id/jobs', async (req, res) => {
    const p = await read(req.params.id); ensureIdle(p);
    const { action, assetId, change } = req.body;
    if (!['plan', 'assets', 'asset', 'build', 'revise'].includes(action)) fail('Unknown generation action.');
    if (change !== undefined && (typeof change !== 'string' || change.length > 4000)) fail('Edit instructions must be below 4000 characters.');
    if (action !== 'plan' && !p.blueprint) fail('Create a blueprint first.');
    if (action === 'revise' && (!p.code || !change?.trim())) fail('A game and edit instructions are required.');
    if (action === 'asset' && !p.blueprint.assets.some(a => a.id === assetId)) fail('Unknown asset.');
    const caps = providers.capabilities();
    if (['plan', 'build', 'revise'].includes(action) && !caps.text) fail('Add OPENAI_API_KEY to the server environment.', 503);
    const required = action === 'assets' ? p.blueprint.assets.filter(a => !p.assets[a.id]) : action === 'asset' ? p.blueprint.assets.filter(a => a.id === assetId) : [];
    if (required.some(a => a.kind === 'image') && !caps.images) fail('Add OPENAI_API_KEY.', 503);
    if (required.some(a => a.kind !== 'image') && !caps.audio) fail('Add ELEVENLABS_API_KEY, or generate/upload individual images first.', 503);
    if ([...jobs.values()].filter(j => ['queued', 'running'].includes(j.status)).length >= 5) fail('Generation queue is full.', 429);
    const job = { id: randomUUID(), projectId: p.id, action, assetId, change, status: 'queued', message: 'Queued', progress: 0, startedAt: new Date().toISOString() };
    jobs.set(job.id, job); await persistJob(job); queueMicrotask(drain);
    res.status(202).json({ id: job.id });
  });
  app.post('/api/studio/projects/:id/cancel', async (req, res) => {
    const p = await read(req.params.id);
    const job = [...jobs.values()].find(j => j.projectId === p.id && ['queued', 'running'].includes(j.status));
    if (!job) fail('No active generation job.', 409);
    if (job.status === 'running') job.controller.abort();
    else { job.status = 'cancelled'; job.message = 'Cancelled'; await persistJob(job); }
    res.json({ ok: true });
  });
  app.use((error, req, res, next) => {
    const status = error.status || (error instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error('[studio]', error.message);
    res.status(status).json({ error: status === 500 ? 'Studio could not save or load this project. Check the server.' : error.message });
  });
  return app;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createStudioApp();
  const port = Number(process.env.STUDIO_PORT || 3002);
  app.listen(port, process.env.STUDIO_HOST || '127.0.0.1', () => console.log(`AI Game Studio worker: http://127.0.0.1:${port} (private workspace)`));
}
