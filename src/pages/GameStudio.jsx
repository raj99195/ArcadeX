import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_SETTINGS, GENRES, STYLES, validateBlueprint } from '../../studio/shared.mjs';
import { createGameDocument, download, readDataURL } from '../studio/runtime';
import { referenceBlueprint, referenceCode, referenceSettings } from '../studio/reference';
import '../studio/studio.css';

const API = '/api/studio';
const running = p => ['queued', 'running'].includes(p?.job?.status);
const labels = { image: 'ART', music: 'MUSIC', sfx: 'SOUND' };
const colours = { spawn: '#7ed9b7', platform: '#6e91b1', enemy: '#ef8f8d', boss: '#cba1ec', coin: '#f3cc82', exit: '#7cd9e4', decoration: '#8994a8' };

function Field({ label, children, hint }) { return <label className="gs-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function Select({ value, options, onChange }) { return <select value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o}>{o}</option>)}</select>; }

export default function GameStudio() {
  const [accessKey, setAccessKey] = useState(() => sessionStorage.getItem('arcadex_studio_access') || '');
  const [connected, setConnected] = useState(false), [caps, setCaps] = useState(null), [connecting, setConnecting] = useState(false);
  const [projects, setProjects] = useState([]), [project, setProject] = useState(null), [draft, setDraft] = useState(null);
  const [prompt, setPrompt] = useState(''), [settings, setSettings] = useState({ ...DEFAULT_SETTINGS });
  const [tab, setTab] = useState('Blueprint'), [levelIndex, setLevelIndex] = useState(0), [entityId, setEntityId] = useState('');
  const [assetId, setAssetId] = useState(''), [assetPrompt, setAssetPrompt] = useState(''), [assets, setAssets] = useState({});
  const [change, setChange] = useState(''), [code, setCode] = useState(''), [raw, setRaw] = useState('');
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [logs, setLogs] = useState([]), [preview, setPreview] = useState(''), [previewKey, setPreviewKey] = useState(0);
  const iframe = useRef(null), channel = useRef(crypto.randomUUID()), currentId = useRef(null), hydrateEpoch = useRef(0);
  const busyRef = useRef(false);
  const pending = busy || running(project);
  const level = draft?.levels[levelIndex];
  const entity = level?.entities.find(e => e.id === entityId);
  const definition = draft?.assets.find(a => a.id === assetId);
  const isReference = project?.id === 'reference';

  async function api(route, options = {}) {
    let response;
    try { response = await fetch(API + route, { ...options, headers: { Authorization: `Bearer ${accessKey.trim()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
    catch { throw new Error('Studio server is unavailable. Start it with npm run studio:server.'); }
    if (!response.ok) { let message; try { message = (await response.json()).error; } catch {} throw new Error(message || `Studio request failed (${response.status}). Start npm run studio:server if needed.`); }
    if (options.binary) return response.blob();
    try { return await response.json(); } catch { throw new Error('Start the studio worker: npm run studio:server.'); }
  }
  async function task(fn) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e.message); } finally { busyRef.current = false; setBusy(false); }
  }
  async function refreshList() { setProjects(await api('/projects')); }
  async function connect() {
    setConnecting(true); setError('');
    try { const status = await api('/status'); sessionStorage.setItem('arcadex_studio_access', accessKey.trim()); setCaps(status); setConnected(true); await refreshList(); }
    catch (e) { setError(e.message); setConnected(false); } finally { setConnecting(false); }
  }
  useEffect(() => { if (accessKey) void connect(); }, []);
  useEffect(() => { const handler = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);

  function accept(p, reset = true) {
    currentId.current = p.id; setProject(p);
    if (reset) { setDraft(p.blueprint ? structuredClone(p.blueprint) : null); setRaw(p.blueprint ? JSON.stringify(p.blueprint, null, 2) : ''); setCode(p.code || ''); setDirty(false); }
  }
  async function openProject(id) {
    if (dirty && !window.confirm('Discard unsaved edits and open another project?')) return;
    await task(async () => { const p = await api(`/projects/${id}`); accept(p); setLevelIndex(0); setEntityId(''); setAssetId(''); setPreview(''); setLogs([]); setTab(p.code ? 'Play' : 'Blueprint'); });
  }
  useEffect(() => {
    if (!project || isReference || !running(project)) return;
    let stopped = false, timer;
    async function poll() {
      try {
        const p = await api(`/projects/${project.id}`);
        if (stopped || currentId.current !== p.id) return;
        accept(p);
        if (!running(p)) { setNotice(p.job?.status === 'completed' ? p.job.message : ''); if (p.job?.error) setError(p.job.error); await refreshList(); }
      } catch (e) { if (!stopped) setError(e.message); }
      if (!stopped) timer = setTimeout(poll, 1800);
    }
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [project?.id, project?.job?.status]);

  const assetFingerprint = JSON.stringify(project?.assets || {});
  useEffect(() => {
    const epoch = ++hydrateEpoch.current;
    setAssets({});
    if (!project || isReference) return;
    void (async () => {
      const next = {};
      try {
        for (const id of Object.keys(project.assets)) next[id] = await readDataURL(await api(`/projects/${project.id}/assets/${id}`, { binary: true }));
        if (hydrateEpoch.current === epoch) setAssets(next);
      } catch (e) { if (hydrateEpoch.current === epoch) setError(e.message); }
    })();
  }, [project?.id, assetFingerprint]);

  useEffect(() => {
    function message(event) {
      if (event.source !== iframe.current?.contentWindow || event.data?.source !== 'arcadex-studio' || event.data?.channel !== channel.current) return;
      const { type, value } = event.data;
      if (type === 'error') setLogs(old => [...old.slice(-19), String(value).slice(0, 2000)]);
      if (type === 'ready') { let value = null; try { value = JSON.parse(localStorage.getItem(`studio-progress-${currentId.current}`) || 'null'); } catch {} iframe.current?.contentWindow.postMessage({ channel: channel.current, type: 'restore-save', value }, '*'); }
      if (type === 'save') { try { const text = JSON.stringify(value); if (text.length < 16000) localStorage.setItem(`studio-progress-${currentId.current}`, text); } catch {} }
    }
    window.addEventListener('message', message); return () => window.removeEventListener('message', message);
  }, []);

  function editBlueprint(next) { setDraft(next); setRaw(JSON.stringify(next, null, 2)); setDirty(true); }
  function editEntity(key, value) { editBlueprint({ ...draft, levels: draft.levels.map((l, i) => i === levelIndex ? { ...l, entities: l.entities.map(e => e.id === entityId ? { ...e, [key]: value } : e) } : l) }); }
  async function save() {
    if (!draft) throw new Error('Create a blueprint first.');
    validateBlueprint(draft, project.settings);
    if (isReference) { const p = { ...project, blueprint: structuredClone(draft), code, versions: [{ id: crypto.randomUUID(), label: 'Reference edit', at: new Date().toISOString(), blueprint: project.blueprint, code: project.code, assets: {} }, ...project.versions].slice(0, 10) }; accept(p); setNotice('Reference updated in memory. Export the project to keep a copy.'); return p; }
    const p = await api(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ blueprint: draft, code }) }); accept(p); setNotice('Project saved.'); return p;
  }
  async function queue(action, extra = {}) {
    await task(async () => {
      if (isReference) throw new Error('Create a saved project with your studio connection before using AI generation.');
      if (dirty) await save();
      await api(`/projects/${project.id}/jobs`, { method: 'POST', body: JSON.stringify({ action, ...extra }) });
      accept(await api(`/projects/${project.id}`));
    });
  }
  async function createProject() {
    await task(async () => {
      if (!connected) throw new Error('Connect the private studio first.');
      const p = await api('/projects', { method: 'POST', body: JSON.stringify({ prompt, settings }) }); accept(p); setTab('Blueprint'); setPreview(''); setLevelIndex(0); await refreshList();
      await api(`/projects/${p.id}/jobs`, { method: 'POST', body: JSON.stringify({ action: 'plan' }) }); accept(await api(`/projects/${p.id}`));
    });
  }
  function openReference() {
    if (dirty && !window.confirm('Discard unsaved edits?')) return;
    const p = { id: 'reference', title: referenceBlueprint.title, prompt: referenceBlueprint.pitch, settings: referenceSettings, blueprint: structuredClone(referenceBlueprint), assets: {}, code: referenceCode, versions: [], notes: 'Hand-authored reference project. Procedural placeholder art is intentional. Generate or upload assets in a saved project to replace it.', checklist: ['Start a new journey', 'Move, double jump and attack', 'Collect shards', 'Reach each beacon', 'Defeat the final guardian', 'Test pause, restart and touch controls'] };
    accept(p); setLevelIndex(0); setAssetId(''); setEntityId(''); setTab('Play'); setAssets({}); setLogs([]); channel.current = crypto.randomUUID(); setPreview(createGameDocument(p, {}, 0, channel.current)); setPreviewKey(n => n + 1);
  }
  async function saveReferenceCopy() {
    await task(async () => { const p = await api('/projects', { method: 'POST', body: JSON.stringify({ prompt: referenceBlueprint.pitch, settings: referenceSettings }) }); const saved = await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ blueprint: draft, code }) }); accept(saved); await refreshList(); setNotice('Reference copied into your saved workspace. You can now generate its art and audio.'); });
  }
  function play() {
    if (!draft || !code) return;
    try { validateBlueprint(draft, project.settings); channel.current = crypto.randomUUID(); setLogs([]); setPreview(createGameDocument({ ...project, blueprint: draft, code }, assets, levelIndex, channel.current)); setPreviewKey(n => n + 1); setTab('Play'); } catch (e) { setError(e.message); }
  }
  async function upload(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    await task(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error('Upload a file below 8 MB.');
      if (dirty) await save();
      const data = await readDataURL(file);
      const p = await api(`/projects/${project.id}/assets/${assetId}`, { method: 'POST', body: JSON.stringify({ mime: file.type, data: data.split(',')[1] }) }); accept(p); setNotice('Asset replaced. Restart preview to use it.');
    });
  }
  function exportProject() {
    download(`${(draft?.title || 'game').replace(/[^a-z0-9]/gi, '-').toLowerCase()}.arcadex.json`, JSON.stringify({ format: 'arcadex-studio', version: 1, prompt: project.prompt, settings: project.settings, blueprint: draft, code, media: assets }, null, 2));
  }
  async function importProject(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    await task(async () => {
      if (!connected) throw new Error('Connect the studio before importing a project.');
      if (file.size > 100 * 1024 * 1024) throw new Error('Project file exceeds 100 MB.');
      const doc = JSON.parse(await file.text());
      if (doc.format !== 'arcadex-studio' || doc.version !== 1) throw new Error('Unsupported project format.');
      validateBlueprint(doc.blueprint, doc.settings);
      const p = await api('/projects', { method: 'POST', body: JSON.stringify({ prompt: doc.prompt, settings: doc.settings }) });
      let saved = await api(`/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ blueprint: doc.blueprint, code: doc.code }) });
      accept(saved);
      for (const [id, data] of Object.entries(doc.media || {})) {
        if (!doc.blueprint.assets.some(a => a.id === id)) continue;
        const match = typeof data === 'string' && data.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
        if (!match) throw new Error('Invalid embedded media. Project imported without this asset.');
        saved = await api(`/projects/${p.id}/assets/${id}`, { method: 'POST', body: JSON.stringify({ mime: match[1], data: match[2] }) }); accept(saved);
      }
      setPreview(''); setTab('Blueprint'); await refreshList(); setNotice('Project imported.');
    });
  }
  const allHydrated = Object.keys(project?.assets || {}).every(id => !!assets[id]);
  return <main className="gs-app">
    <header className="gs-header"><Link to="/" className="gs-brand"><span className="gs-brand-mark">A<span>✦</span></span>ARCADE<span>X</span></Link><span className="gs-header-divider" /><Link to="/studio" className="gs-product">Game Studio <span className="gs-tag">PRIVATE BETA</span></Link><div className="gs-header-right"><span className={`gs-status ${connected ? 'online' : ''}`} /><span className="gs-connection-label">{connected ? 'Workspace connected' : 'Local-first development'}</span><a href="#connection" className="gs-text-button">API setup ↗</a></div></header>
    <div className="gs-shell">
      <aside className="gs-sidebar">
        <div className="gs-sidebar-title">WORKSPACE <span>01</span></div>
        <button className="gs-new" disabled={pending} onClick={() => { if (dirty && !window.confirm('Discard unsaved edits?')) return; currentId.current = null; setProject(null); setDraft(null); setPreview(''); setDirty(false); }}>＋ New game</button>
        <div className="gs-section-label">YOUR PROJECTS <span>{projects.length.toString().padStart(2, '0')}</span></div>
        <div className="gs-project-list">{projects.map(p => <button key={p.id} disabled={pending} className={`gs-project ${p.id === project?.id ? 'selected' : ''}`} onClick={() => openProject(p.id)}><span className="gs-project-icon">{p.hasBuild ? '◈' : '◇'}</span><span><strong>{p.title}</strong><small>{p.genre}</small></span></button>)}{!projects.length && <p className="gs-small-muted">Your game worlds will live here.</p>}</div>
        <button className="gs-reference" disabled={pending} onClick={openReference}><span>✧</span><strong>Explore a complete project</strong><small>3 levels · combat · boss · editable</small><span className="gs-reference-link">Open reference game ↗</span></button>
        <div className="gs-connection" id="connection"><div className="gs-section-label">PRIVATE STUDIO ACCESS</div><p>Provider keys stay on your server. Enter your separate studio access key.</p><input aria-label="Studio access key" type="password" autoComplete="off" value={accessKey} onChange={e => setAccessKey(e.target.value)} placeholder="STUDIO_ACCESS_KEY" disabled={pending} /><button disabled={!accessKey.trim() || connecting || pending} onClick={connect}>{connecting ? 'Connecting…' : 'Connect workspace'}</button>{caps && <div className="gs-capabilities"><span className={caps.text ? 'ready' : ''}>● Planning & code</span><span className={caps.images ? 'ready' : ''}>● Art generation</span><span className={caps.audio ? 'ready' : ''}>● Music & sound</span><small>Status checks key presence; live access is verified when generating.</small></div>}</div>
        <label className="gs-import">↥ Import project<input type="file" accept=".json" disabled={!connected || pending} onChange={importProject} /></label>
        <div className="gs-sidebar-foot">Built for imagination.<br /><span>Powered by your creative direction.</span></div>
      </aside>
      <section className="gs-main">
        {error && <div className="gs-alert" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {notice && <div className="gs-notice" role="status">✓ {notice}</div>}
        {!project ? <>
          <div className="gs-breadcrumb">WORKSPACE <span>/</span> NEW GAME</div>
          <div className="gs-hero"><div className="gs-eyebrow"><span /> YOUR NEXT WORLD STARTS HERE</div><h1>An idea.<br />An entire <em>game world.</em></h1><p>Design the adventure. Shape every detail.<br />Create a complete 2D game with art, sound and a world of your own.</p><div className="gs-hero-orbit" aria-hidden="true"><div className="gs-orbit o1" /><div className="gs-orbit o2" /><div className="gs-orbit-core">✦</div><span className="gs-orbit-label l1">YOUR WORLD</span><span className="gs-orbit-label l2">INFINITE POSSIBILITIES</span></div></div>
          <div className="gs-create-panel"><div className="gs-panel-heading"><span className="gs-step">01</span><div><h2>Describe your game</h2><p>Think characters, setting, mechanics and the feeling you want to create.</p></div><span className="gs-tag">2D GAMES</span></div><textarea className="gs-prompt" aria-label="Game idea" value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={6000} placeholder="A lone sky pirate exploring floating islands, with grappling hooks, ancient machines and a storm dragon guarding the final island…" /><div className="gs-prompt-footer"><span>✧ Be specific. This is your creative brief.</span><span>{prompt.length}/6000</span></div><div className="gs-suggestions">{['A forest adventure with ancient guardians', 'A neon city survival game', 'A space explorer solving alien puzzles'].map(s => <button key={s} onClick={() => setPrompt(s)}>{s} ↗</button>)}</div></div>
          <div className="gs-create-panel"><div className="gs-panel-heading"><span className="gs-step">02</span><div><h2>Make it yours</h2><p>Choose the scope. AI will turn your choices into an editable blueprint.</p></div></div><div className="gs-setup-grid"><Field label="GAME GENRE"><Select value={settings.genre} options={GENRES} onChange={genre => setSettings({ ...settings, genre })} /></Field><Field label="ART DIRECTION"><Select value={settings.style} options={STYLES} onChange={style => setSettings({ ...settings, style })} /></Field><Field label="GAME STRUCTURE"><select value={settings.structure} onChange={e => setSettings({ ...settings, structure: e.target.value })}><option value="levels">Level-based journey</option><option value="endless">Endless progression</option></select></Field><Field label="NUMBER OF LEVELS" hint="1–10 for this beta; more levels increase generation scope."><input type="number" min="1" max="10" disabled={settings.structure === 'endless'} value={settings.structure === 'endless' ? 1 : settings.levelCount} onChange={e => setSettings({ ...settings, levelCount: Number(e.target.value) })} /></Field><Field label="DIFFICULTY"><Select value={settings.difficulty} options={['Relaxed', 'Balanced', 'Challenging']} onChange={difficulty => setSettings({ ...settings, difficulty })} /></Field><Field label="PLAY ON"><Select value={settings.controls} options={['Desktop', 'Desktop + touch']} onChange={controls => setSettings({ ...settings, controls })} /></Field></div><div className="gs-feature-toggles">{[['bosses', 'Boss encounters', 'Memorable end-of-stage battles'], ['upgrades', 'Player progression', 'Abilities, upgrades & unlocks'], ['story', 'Story & world', 'A purpose behind the adventure'], ['music', 'Original music', 'A soundtrack for your world'], ['sfx', 'Sound effects', 'Every action has an impact']].map(([key, name, sub]) => <label key={key} className={`gs-toggle-card ${settings[key] ? 'active' : ''}`}><input type="checkbox" checked={settings[key]} onChange={e => setSettings({ ...settings, [key]: e.target.checked })} /><span><strong>{name}</strong><small>{sub}</small></span><span className="gs-switch" /></label>)}</div><div className="gs-create-footer"><p><strong>You stay in control.</strong> Review the blueprint before generating art, audio or gameplay. Provider usage is billed separately.</p><button className="gs-primary" disabled={pending || !connected || prompt.trim().length < 12 || !caps?.text} onClick={createProject}>{busy ? 'Creating…' : 'Create game blueprint'} <span>↗</span></button></div></div>
          <div className="gs-workflow">{[['01', 'Imagine', 'Your prompt & creative choices'], ['02', 'Direct', 'Review the world and its assets'], ['03', 'Create', 'Generate art, audio & gameplay'], ['04', 'Make it yours', 'Play, edit, export & iterate']].map(([n, title, sub]) => <div key={n}><span>{n}</span><strong>{title}</strong><small>{sub}</small></div>)}</div>
        </> : <>
          <div className="gs-breadcrumb">WORKSPACE <span>/</span> {isReference ? 'REFERENCE PROJECT' : 'GAME PROJECT'}</div>
          <div className="gs-editor-heading"><div><div className="gs-eyebrow">{isReference ? 'HAND-AUTHORED REFERENCE · IN-MEMORY EDITS' : 'YOUR EDITABLE GAME WORLD'}</div><h1>{draft?.title || project.title}</h1><p>{draft?.pitch || 'Creating your game blueprint…'}</p></div><div className="gs-actions"><button disabled={pending || !draft} onClick={() => task(save)}>{dirty ? '● Save changes' : 'Save'}</button>{isReference && connected && <button disabled={pending} onClick={saveReferenceCopy}>Save workspace copy</button>}<button disabled={!draft || !allHydrated || pending} onClick={exportProject}>Export project ↗</button></div></div>
          {project.job && <div className={`gs-job ${project.job.status}`}><div><strong>{project.job.message}</strong><span>{project.job.status}{project.job.progress ? ` · ${project.job.progress}%` : ''}</span></div><div className="gs-progress"><span style={{ width: `${project.job.progress || 3}%` }} /></div>{running(project) && <button onClick={() => task(async () => { await api(`/projects/${project.id}/cancel`, { method: 'POST' }); setNotice('Cancellation requested. Provider work already started may still be billed.'); })}>Cancel job</button>}{project.job.error && <p>{project.job.error}</p>}</div>}
          <div className="gs-editor-tabs">{['Blueprint', 'Levels', 'Assets', 'Play', 'Code', 'History'].map(t => <button key={t} className={tab === t ? 'active' : ''} disabled={!draft && t !== 'Blueprint'} onClick={() => { if (t === 'Play' && code) play(); else setTab(t); }}>{t}{t === 'Assets' && draft && <span>{Object.keys(project.assets).length}/{draft.assets.length}</span>}</button>)}<span>{dirty ? '● Unsaved changes' : isReference ? 'Reference project' : '✓ Saved to workspace'}</span></div>
          {!draft ? <div className="gs-empty"><div className="gs-empty-symbol">✧</div><h2>{running(project) ? 'Designing your world…' : 'Your blueprint is waiting'}</h2><p>{running(project) ? 'Defining levels, mechanics, art direction and an asset plan.' : 'Your prompt is saved. Generate its blueprint when your API is ready.'}</p>{!running(project) && <button className="gs-primary" disabled={pending} onClick={() => queue('plan')}>Generate blueprint</button>}</div> : <>
            {tab === 'Blueprint' && <div className="gs-blueprint"><div className="gs-create-panel"><div className="gs-panel-heading"><span className="gs-step">01</span><div><h2>Creative direction</h2><p>The source of truth for your game. Everything below is editable.</p></div></div><Field label="GAME TITLE"><input disabled={pending} value={draft.title} onChange={e => editBlueprint({ ...draft, title: e.target.value })} /></Field><Field label="ART DIRECTION"><textarea disabled={pending} value={draft.artDirection} onChange={e => editBlueprint({ ...draft, artDirection: e.target.value })} /></Field><Field label="STORY"><textarea disabled={pending} value={draft.story} onChange={e => editBlueprint({ ...draft, story: e.target.value })} /></Field><div className="gs-stat-grid">{Object.entries(draft.player).map(([key, value]) => <Field key={key} label={key.toUpperCase()}><input type="number" min="1" max="2000" disabled={pending} value={value} onChange={e => editBlueprint({ ...draft, player: { ...draft.player, [key]: Number(e.target.value) } })} /></Field>)}</div><h3>Core mechanics</h3><div className="gs-chips">{draft.mechanics.map((m, i) => <span key={i}>{m}</span>)}</div><h3>Controls</h3><p className="gs-body-text">{draft.controls.join(' · ')}</p></div><div><div className="gs-create-panel"><div className="gs-section-label">GENERATION PLAN</div><div className="gs-plan-counts"><div><strong>{draft.levels.length}</strong><span>levels / arenas</span></div><div><strong>{draft.assets.filter(a => a.kind === 'image').length}</strong><span>art assets</span></div><div><strong>{draft.assets.filter(a => a.kind !== 'image').length}</strong><span>audio assets</span></div></div><p className="gs-body-text">Review the asset prompts before generating. Each generation or regeneration uses your provider balance. No fixed credit quote is available yet.</p><button className="gs-primary gs-full" disabled={pending || isReference || !caps?.text} onClick={() => queue('assets')}>Generate missing assets ↗</button><button className="gs-secondary gs-full" disabled={pending || isReference || !caps?.text} onClick={() => queue('build')}>Build playable game ↗</button><small className="gs-small-muted">You can build before all assets are ready; missing art uses procedural fallbacks. Rebuild after gameplay changes. Restart preview after asset replacement.</small></div><div className="gs-create-panel"><div className="gs-section-label">YOUR JOURNEY</div>{draft.levels.map((l, i) => <button className="gs-level-summary" key={l.id} onClick={() => { setLevelIndex(i); setTab('Levels'); }}><span>{String(i + 1).padStart(2, '0')}</span><div><strong>{l.name}</strong><small>{l.objective}</small></div><b>↗</b></button>)}</div></div></div>}
            {tab === 'Levels' && <div className="gs-level-editor"><div className="gs-level-work"><div className="gs-level-toolbar"><Select value={level?.name || ''} options={draft.levels.map(l => l.name)} onChange={name => { setLevelIndex(draft.levels.findIndex(l => l.name === name)); setEntityId(''); }} /><span>Click an object to select · drag to move</span><button disabled={pending || !level} onClick={() => { const id = `object_${crypto.randomUUID().slice(0,8)}`; editBlueprint({ ...draft, levels: draft.levels.map((l, i) => i === levelIndex ? { ...l, entities: [...l.entities, { id, type: 'enemy', x: 300, y: 400, width: 40, height: 40, assetId: '' }] } : l) }); setEntityId(id); }}>＋ Add object</button></div>{level && <svg className="gs-level-canvas" viewBox={`0 0 ${level.width} ${level.height}`} role="img" aria-label="Editable level map" onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId) || !entity || pending) return; const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(e.currentTarget.getScreenCTM().inverse()); const next = { ...entity, x: Math.round(Math.max(0, Math.min(level.width, point.x))), y: Math.round(Math.max(0, Math.min(level.height, point.y))) }; editBlueprint({ ...draft, levels: draft.levels.map((l, i) => i === levelIndex ? { ...l, entities: l.entities.map(v => v.id === next.id ? next : v) } : l) }); }} onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}><defs><pattern id="gs-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#283449" strokeWidth="1" /></pattern></defs><rect width={level.width} height={level.height} fill="url(#gs-grid)" />{level.entities.map(e => <g key={e.id} onPointerDown={event => { if (pending) return; setEntityId(e.id); event.currentTarget.ownerSVGElement.setPointerCapture(event.pointerId); }} className="gs-map-object"><rect x={e.x - e.width/2} y={e.y - e.height/2} width={e.width} height={e.height} fill={colours[e.type]} fillOpacity={entityId === e.id ? .95 : .6} stroke={entityId === e.id ? '#fff' : colours[e.type]} strokeWidth={entityId === e.id ? 4 : 1} rx="4" /><text x={e.x} y={e.y - e.height/2 - 8} fill={colours[e.type]} fontSize="16" textAnchor="middle">{e.type}</text></g>)}</svg>}<div className="gs-map-legend">{Object.entries(colours).map(([name, color]) => <span key={name}><i style={{ background: color }} />{name}</span>)}</div><Field label="LEVEL OBJECTIVE"><input disabled={pending} value={level?.objective || ''} onChange={e => editBlueprint({ ...draft, levels: draft.levels.map((l,i) => i === levelIndex ? { ...l, objective:e.target.value } : l) })} /></Field><details className="gs-json"><summary>Advanced blueprint JSON</summary><textarea aria-label="Blueprint JSON" disabled={pending} value={raw} onChange={e => setRaw(e.target.value)} /><button disabled={pending} onClick={() => { try { const next = JSON.parse(raw); validateBlueprint(next, project.settings); editBlueprint(next); setEntityId(''); setLevelIndex(0); } catch(e) { setError(e.message); } }}>Apply JSON to editor</button></details></div><div className="gs-inspector"><div className="gs-section-label">OBJECT INSPECTOR</div>{entity ? <><h3>{entity.id}</h3><Field label="TYPE"><Select value={entity.type} options={Object.keys(colours)} onChange={type => !pending && editEntity('type',type)} /></Field><div className="gs-stat-grid">{['x','y','width','height'].map(key => <Field key={key} label={key.toUpperCase()}><input type="number" disabled={pending} value={entity[key]} onChange={e => editEntity(key,Number(e.target.value))} /></Field>)}</div><Field label="ART ASSET"><select disabled={pending} value={entity.assetId} onChange={e => editEntity('assetId',e.target.value)}><option value="">Procedural fallback</option>{draft.assets.filter(a => a.kind === 'image').map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></Field><button className="gs-danger" disabled={pending} onClick={() => { editBlueprint({ ...draft, levels: draft.levels.map((l,i) => i === levelIndex ? { ...l, entities: l.entities.filter(e => e.id !== entityId) } : l) }); setEntityId(''); }}>Delete object</button></> : <p className="gs-small-muted">Select an object on the map to edit its position, size and art.</p>}<p className="gs-small-muted">Coordinates use object centers. Keep a spawn and exit in every level. Preview to verify reachability after moving platforms.</p></div></div>}
            {tab === 'Assets' && <div className="gs-assets-layout"><div><div className="gs-asset-toolbar"><p>Every asset has its own prompt. Replace one without regenerating the entire game.</p><button disabled={pending || isReference} onClick={() => queue('assets')}>Generate missing assets ↗</button></div><div className="gs-assets-grid">{draft.assets.map(a => <button className={`gs-asset-card ${assetId === a.id ? 'selected' : ''}`} key={a.id} onClick={() => { setAssetId(a.id); setAssetPrompt(a.prompt); }}><div className={`gs-asset-visual ${a.kind}`}>{a.kind === 'image' && assets[a.id] ? <img src={assets[a.id]} alt={a.name} /> : <span>{a.kind === 'image' ? '◇' : a.kind === 'music' ? '♫' : '≋'}</span>}<b>{project.assets[a.id] ? 'READY' : 'PLANNED'}</b></div><div className="gs-asset-caption"><span>{labels[a.kind]} · {a.role}</span><strong>{a.name}</strong><small>{a.kind === 'image' ? project.assets[a.id]?.source || 'Not generated yet' : `${a.duration}s · ${project.assets[a.id]?.source || 'Not generated yet'}`}</small></div></button>)}</div></div><div className="gs-inspector"><div className="gs-section-label">ASSET DIRECTION</div>{definition ? <><h3>{definition.name}</h3>{assets[assetId] && definition.kind !== 'image' && <audio controls src={assets[assetId]} />}<Field label="DESCRIBE THIS ASSET"><textarea disabled={pending} value={assetPrompt} onChange={e => setAssetPrompt(e.target.value)} maxLength={3500} /></Field><button className="gs-full" disabled={pending || !assetPrompt.trim()} onClick={() => { editBlueprint({ ...draft, assets: draft.assets.map(a => a.id === assetId ? { ...a, prompt: assetPrompt } : a) }); setNotice('Prompt updated in the editor. Save or generate to persist it.'); }}>Update asset prompt</button><button className="gs-primary gs-full" disabled={pending || isReference || !assetPrompt.trim()} onClick={() => queue('asset', { assetId, change: assetPrompt })}>{project.assets[assetId] ? 'Regenerate / edit asset' : 'Generate asset'} ↗</button><small className="gs-small-muted">PNG image edits use the existing image as reference. Generated animation frames are not included in this beta.</small><label className="gs-upload">↥ Upload replacement<input type="file" accept={definition.kind === 'image' ? 'image/png,image/jpeg,image/webp' : 'audio/mpeg,audio/wav,audio/ogg'} disabled={pending || isReference} onChange={upload} /></label></> : <p className="gs-small-muted">Select an asset to edit its prompt, generate it or upload a replacement.</p>}</div></div>}
            {tab === 'Play' && <div className="gs-preview-layout"><div><div className="gs-preview-toolbar"><span><i className="gs-status online" /> PLAYTEST PREVIEW</span><button disabled={!code || !allHydrated} onClick={play}>↻ Restart preview</button><button disabled={!code || !allHydrated || pending} onClick={() => download('game.html',createGameDocument({ ...project, blueprint:draft,code },assets,0,'',true),'text/html')}>Export playable HTML ↗</button></div><div className="gs-preview">{preview ? <iframe key={previewKey} ref={iframe} srcDoc={preview} sandbox="allow-scripts" allow="autoplay; gamepad" title="Sandboxed game preview" /> : <div className="gs-empty"><div className="gs-empty-symbol">▷</div><h2>{code ? 'Ready to play' : 'Your world is taking shape'}</h2><p>{code ? 'Start your preview to playtest the game.' : 'Generate a playable build from the Blueprint tab.'}</p>{code && <button onClick={play}>Start preview</button>}</div>}</div><div className="gs-console"><span>RUNTIME CHECKS</span>{logs.length ? logs.map((log,i) => <p key={i}>{log}</p>) : <p>No runtime errors reported. Playtest controls, objectives and transitions manually.</p>}</div>{project.notes && <div className="gs-build-notes"><h3>Build notes</h3><p>{project.notes}</p>{project.checklist?.length > 0 && <><h3>Suggested playtest checklist</h3>{project.checklist.map((c,i) => <label key={i}><input type="checkbox" />{c}</label>)}</>}</div>}</div><div className="gs-inspector"><div className="gs-section-label">DIRECT YOUR GAME</div><h3>What should change?</h3><p className="gs-small-muted">Describe a gameplay change. AI revises the code while keeping your blueprint and assets.</p><textarea aria-label="Gameplay edit instructions" value={change} onChange={e => setChange(e.target.value)} maxLength={4000} placeholder="Add a dash ability and make the final boss attack in three phases…" disabled={pending} /><button className="gs-primary gs-full" disabled={pending || !code || !change.trim() || isReference} onClick={() => queue('revise',{ change: change + (logs.length ? `\nRuntime errors to fix:\n${logs.join('\n')}` : '') })}>Apply gameplay changes ↗</button><p className="gs-small-muted">For art changes, use Assets. For positions and player values, use Levels or Blueprint. Revisions create a restore point.</p><Field label="STARTING LEVEL"><select value={levelIndex} onChange={e => setLevelIndex(Number(e.target.value))}>{draft.levels.map((l,i) => <option key={l.id} value={i}>{l.name}</option>)}</select></Field></div></div>}
            {tab === 'Code' && <div className="gs-code-panel"><div className="gs-panel-heading"><div><h2>Game source</h2><p>Phaser 3.90 · JavaScript · window.STUDIO provides editable project data and assets.</p></div><button disabled={pending} onClick={() => task(save)}>Save source</button></div><textarea spellCheck="false" aria-label="Game source code" value={code} onChange={e => { setCode(e.target.value); setDirty(true); }} disabled={pending} placeholder="Generate a playable build to see the game source here." /></div>}
            {tab === 'History' && <div className="gs-create-panel"><h2>Version history</h2><p className="gs-body-text">Restore blueprint, source and asset references together. The latest 10 restore points are retained.</p>{!project.versions.length && <p className="gs-small-muted">Your first save or generation creates a restore point.</p>}{project.versions.map(v => <div className="gs-version" key={v.id}><span>↶</span><div><strong>{v.label}</strong><small>{new Date(v.at).toLocaleString()}</small></div><button disabled={pending} onClick={() => task(async () => { if (isReference) { accept({ ...project, blueprint:v.blueprint,code:v.code }); } else accept(await api(`/projects/${project.id}/restore/${v.id}`,{method:'POST'})); setPreview(''); setLevelIndex(0); setEntityId(''); setNotice('Version restored. Restart the preview to play it.'); })}>Restore version</button></div>)}</div>}
          </>}
        </>}
        <footer className="gs-main-footer"><span>ARCADEX GAME STUDIO</span><span>Imagine it. Build it. Make it yours. <b>✦</b></span></footer>
      </section>
    </div>
  </main>;
}
