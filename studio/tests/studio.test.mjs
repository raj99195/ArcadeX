import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, validateBlueprint, validateSettings } from '../shared.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'arcadex-studio-test-'));
process.env.STUDIO_DATA_DIR = temp;
process.env.STUDIO_ACCESS_KEY = 'test-studio-secret-not-a-provider-key';
process.env.OPENAI_API_KEY = 'test-openai-do-not-send';
process.env.ELEVENLABS_API_KEY = 'test-eleven-do-not-send';
const { createStudioApp } = await import('../server.mjs');
const realFetch = globalThis.fetch;
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
let base, server, imageCalls = 0, audioCalls = 0, failAudio = false, refuse = false, incomplete = false;
const blueprint = {
  title: 'Test World', pitch: 'A complete test adventure.', artDirection: 'Illustrated forest.', story: 'Restore the beacon.', mechanics: ['Explore'], controls: ['Arrows'],
  player: { speed: 200, jump: 400, health: 5, damage: 1 },
  levels: [{ id: 'one', name: 'One', objective: 'Find exit', width: 960, height: 540, background: 'forest', entities: [{ id: 'spawn', type: 'spawn', x: 60, y: 400, width: 32, height: 48, assetId: '' }, { id: 'exit', type: 'exit', x: 900, y: 400, width: 32, height: 48, assetId: '' }] }],
  assets: [{ id: 'forest', name: 'Forest', kind: 'image', role: 'background', prompt: 'A forest background', duration: 0 }, { id: 'hit', name: 'Hit', kind: 'sfx', role: 'attack', prompt: 'A sword hit', duration: 1 }],
};
const settings = { ...DEFAULT_SETTINGS, levelCount: 1 };
const gameCode = 'new Phaser.Game({parent:"game",width:960,height:540});' + '/* Complete test fixture, not generated gameplay. */'.repeat(15);
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('http://127.0.0.1:')) return realFetch(url, options);
  if (String(url) === 'https://api.openai.com/v1/responses') {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer test-openai-do-not-send');
    const value = body.text.format.name === 'game_blueprint' ? blueprint : { code: gameCode, notes: 'Fixture', checklist: ['Playtest'] };
    return Response.json({ status: incomplete ? 'incomplete' : 'completed', output: [{ content: refuse ? [{ type: 'refusal' }] : [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  }
  if (String(url).startsWith('https://api.openai.com/v1/images/')) { imageCalls++; return Response.json({ data: [{ b64_json: imageBytes.toString('base64') }] }); }
  if (String(url).startsWith('https://api.elevenlabs.io/v1/')) { audioCalls++; return failAudio ? new Response('{}', { status: 429 }) : new Response(Buffer.from('fake audio fixture'), { headers: { 'Content-Type': 'audio/mpeg' } }); }
  throw new Error(`Unexpected network access: ${url}`);
};
before(async () => { const app = await createStudioApp(); server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api/studio`; });
after(async () => { globalThis.fetch = realFetch; await new Promise(resolve => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true }); });
async function call(route, method = 'GET', body, key = process.env.STUDIO_ACCESS_KEY) {
  const response = await fetch(base + route, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
async function create() { const result = await call('/projects', 'POST', { prompt: 'A forest adventure with a guardian', settings }); assert.equal(result.status, 201); return result.data; }
async function done(id) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const { data } = await call(`/projects/${id}`); if (!['queued', 'running'].includes(data.job?.status)) return data; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Job did not finish');
}
test('validates structural choices and rejects broken editable maps', () => {
  assert.equal(validateSettings({ ...settings, structure: 'endless', levelCount: 8 }).levelCount, 1);
  assert.throws(() => validateSettings({ ...settings, levelCount: 999 }));
  assert.equal(validateBlueprint(structuredClone(blueprint), settings).title, 'Test World');
  const bad = structuredClone(blueprint); bad.levels[0].entities.pop(); assert.throws(() => validateBlueprint(bad, settings), /spawn and exit/);
  const duplicate = structuredClone(blueprint); duplicate.assets.push(duplicate.assets[0]); assert.throws(() => validateBlueprint(duplicate, settings), /unique/);
});
test('requires private access, does not expose provider secrets, and rejects invalid setup', async () => {
  assert.equal((await call('/status', 'GET', undefined, 'wrong')).status, 401);
  const status = await call('/status'); assert.equal(status.status, 200); assert.equal(status.data.text, true); assert.ok(!JSON.stringify(status.data).includes('test-openai'));
  assert.equal((await call('/projects', 'POST', { prompt: 'A complete game', settings: { ...settings, levelCount: -1 } })).status, 400);
});
test('plans, persists, checkpoints partial assets, resumes without repeating paid images, builds and restores versions', async () => {
  const p = await create();
  assert.equal((await call(`/projects/${p.id}/jobs`, 'POST', { action: 'plan' })).status, 202);
  let saved = await done(p.id); assert.equal(saved.blueprint.title, 'Test World'); assert.equal(saved.job.status, 'completed');
  failAudio = true;
  await call(`/projects/${p.id}/jobs`, 'POST', { action: 'assets' }); saved = await done(p.id);
  assert.equal(saved.job.status, 'failed'); assert.ok(saved.assets.forest); assert.equal(imageCalls, 1); assert.equal(audioCalls, 1);
  failAudio = false;
  await call(`/projects/${p.id}/jobs`, 'POST', { action: 'assets' }); saved = await done(p.id);
  assert.equal(saved.job.status, 'completed'); assert.equal(imageCalls, 1); assert.equal(audioCalls, 2);
  await call(`/projects/${p.id}/jobs`, 'POST', { action: 'build' }); saved = await done(p.id);
  assert.equal(saved.code, gameCode);
  const invalid = await call(`/projects/${p.id}`, 'PUT', { code: 'function (' }); assert.equal(invalid.status, 400);
  const changed = structuredClone(saved.blueprint); changed.player.speed = 310;
  saved = (await call(`/projects/${p.id}`, 'PUT', { blueprint: changed, code: gameCode })).data;
  const version = saved.versions[0]; assert.equal(version.blueprint.player.speed, 200);
  saved = (await call(`/projects/${p.id}/restore/${version.id}`, 'POST')).data; assert.equal(saved.blueprint.player.speed, 200);
  const disk = JSON.parse(await fs.readFile(path.join(temp, p.id, 'project.json'), 'utf8')); assert.equal(disk.code, gameCode);
  const asset = await realFetch(`${base}/projects/${p.id}/assets/forest`, { headers: { Authorization: `Bearer ${process.env.STUDIO_ACCESS_KEY}` } }); assert.equal(asset.status, 200); assert.deepEqual(Buffer.from(await asset.arrayBuffer()), imageBytes);
  assert.equal((await call(`/projects/${p.id}/assets/unknown`, 'POST', { mime:'image/png',data:imageBytes.toString('base64') })).status, 404);
});
test('provider refusals and truncated responses fail without committing a blueprint', async () => {
  const p = await create(); refuse = true;
  await call(`/projects/${p.id}/jobs`, 'POST', { action:'plan' }); let saved = await done(p.id); assert.equal(saved.job.status,'failed'); assert.equal(saved.blueprint,null);
  refuse = false; incomplete = true;
  await call(`/projects/${p.id}/jobs`, 'POST', { action:'plan' }); saved = await done(p.id); assert.equal(saved.job.status,'failed'); assert.match(saved.job.error,/incomplete/); incomplete = false;
});
test('a restarted worker marks unfinished jobs interrupted instead of repeating billing', async () => {
  const p = await create(); const target = path.join(temp,p.id,'project.json');
  p.job = { id:'interrupted-test', action:'assets', status:'running' }; await fs.writeFile(target,JSON.stringify(p));
  await createStudioApp();
  const disk=JSON.parse(await fs.readFile(target,'utf8')); assert.equal(disk.job.status,'interrupted');
});
test('asset uploads are authenticated, typed, bounded and versioned', async () => {
  const p=await create();
  await call(`/projects/${p.id}`, 'PUT', {blueprint,code:gameCode});
  const wrong=await call(`/projects/${p.id}/assets/forest`, 'POST', {mime:'audio/mpeg',data:'ZmFrZQ=='}); assert.equal(wrong.status,400);
  const svg=await call(`/projects/${p.id}/assets/forest`, 'POST', {mime:'image/svg+xml',data:'PHN2Zy8+'}); assert.equal(svg.status,400);
  const uploaded=await call(`/projects/${p.id}/assets/forest`, 'POST', {mime:'image/png',data:imageBytes.toString('base64')}); assert.equal(uploaded.status,200); assert.equal(uploaded.data.assets.forest.source,'uploaded');
  const oldVersion=uploaded.data.versions[0];
  const restored=await call(`/projects/${p.id}/restore/${oldVersion.id}`, 'POST'); assert.equal(restored.data.assets.forest,undefined);
  const denied=await realFetch(`${base}/projects/${p.id}/assets/forest`); assert.equal(denied.status,401);
});
