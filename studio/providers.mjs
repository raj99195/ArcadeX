import { blueprintSchema, buildSchema, validateBlueprint } from './shared.mjs';

export class ProviderError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
async function request(url, options, signal) {
  const timeout = AbortSignal.timeout(240000);
  let response;
  try { response = await fetch(url, { ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
  catch (error) {
    if (signal?.aborted) throw new Error('Generation cancelled.');
    throw new ProviderError(error.name === 'TimeoutError' ? 'Provider timed out. Check provider usage before retrying.' : 'Provider connection failed. Check provider usage before retrying.');
  }
  if (!response.ok) {
    // Never expose raw provider bodies: they can contain account details.
    await response.body?.cancel();
    throw new ProviderError(`Provider returned HTTP ${response.status}. Check API access, billing and the selected model.`, response.status === 429 ? 429 : 502);
  }
  return response;
}
export function capabilities(env = process.env) {
  return { text: !!env.OPENAI_API_KEY, images: !!env.OPENAI_API_KEY, audio: !!env.ELEVENLABS_API_KEY };
}
async function structured(name, schema, instructions, input, signal) {
  if (!process.env.OPENAI_API_KEY) throw new ProviderError('Add OPENAI_API_KEY to the server environment.', 503);
  const response = await request('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.STUDIO_TEXT_MODEL || 'gpt-5.4', instructions, input: JSON.stringify(input), max_output_tokens: name === 'game_build' ? 24000 : 16000,
      text: { format: { type: 'json_schema', name, strict: true, schema } } }),
  }, signal);
  const data = await response.json();
  if (data.status !== 'completed') throw new ProviderError('Model output was incomplete. Reduce scope and retry.');
  const content = (data.output || []).flatMap(item => item.content || []);
  if (content.some(item => item.type === 'refusal')) throw new ProviderError('The provider declined this request. Try a different game description.', 422);
  try { return JSON.parse(content.filter(c => c.type === 'output_text').map(c => c.text).join('')); }
  catch { throw new ProviderError('Provider returned an invalid project document.'); }
}
export async function plan(project, signal) {
  const result = await structured('game_blueprint', blueprintSchema, `You are a senior 2D game designer creating a COMPLETE, polished browser game, not a basic minigame. Produce a practical editable game blueprint matching the user's setup. Include meaningful progression, varied encounters, clear objectives, and a coherent visual direction. Exactly the requested levelCount for levels mode, one reusable arena for endless mode. Coordinates are pixels, y downwards. Default viewport 960x540. Keep levels reachable and completable; ground/platforms should support spawn and exit. Include bosses only if enabled, story only if enabled. Up to 12 image assets and 6 audio assets, maximum 18 total. Reuse coherent assets across levels. Image roles should include player, enemy, background, platform, boss where relevant. Every asset id must be unique lowercase snake_case. Each entity assetId and level background must reference a declared image asset (or empty string for untextured objects). Every level MUST contain spawn and exit entities. Assets are single images, NOT sprite sheets. Plan movement animation through code/tweens; do not claim multi-frame animation exists. Prompts must explicitly describe the supplied art style and consistent visual palette. For characters/objects request an isolated single full-body sprite with transparent background; for backgrounds request an environment without UI/text. Music 20–45 seconds; sfx 0.5–3 seconds. Include audio only if requested. No third-party IP or branded characters.`, { prompt: project.prompt, settings: project.settings }, signal);
  validateBlueprint(result, project.settings);
  if (result.assets.filter(a => a.kind === 'image').length > 12 || result.assets.some(a => a.kind === 'music' && !project.settings.music || a.kind === 'sfx' && !project.settings.sfx)) throw new ProviderError('Generated asset plan did not match the setup. Please retry the blueprint.');
  return result;
}
export async function build(project, change, signal) {
  const blueprint = project.blueprint;
  const result = await structured('game_build', buildSchema, `You are an expert Phaser 3.90 game engineer. Return a COMPLETE self-contained JavaScript program, not HTML or markdown. Phaser is already loaded. window.STUDIO contains {blueprint, settings, assets, initialLevel, save, load}. assets is an object mapping asset IDs to data URLs for actually available images/audio; missing assets MUST get attractive procedural fallback textures. Use ONLY those assets, NO URLs/network/import/eval. Create Phaser.Game parent:'game', scale FIT/CENTER_BOTH at 960x540. Read ALL level entities and player stats from STUDIO.blueprint at startup; never hardcode their positions. Initial selected level is STUDIO.initialLevel. All declared levels must be playable with reachable goals, next-level transitions and a victory screen. Implement coherent polished mechanics appropriate to genre, a title screen with click-to-start to unlock sound, HUD, pause/restart, save/resume using STUDIO.save/load (not localStorage), health, enemy encounters, damage invulnerability, progression/upgrades if enabled, boss behaviour if enabled. Respect endless structure. Never require bosses to clear when bosses setting is false. Provide desktop controls and touch buttons if requested. Build real game logic, not a visual demo. Use actual asset IDs for textures and audio. Preload data URLs via this.load.image/audio. Use procedural animation/tweens for single-image sprites, NOT assumed sprite sheets. No asset dimensions are guaranteed: normalize display sizes and physics body sizes. Platformer physics need stable ground bodies and working jump/collision. Ensure UI is scrollFactor(0). Stop all playing music on scene restart. Use window.STUDIO.save({level, ...}) and load() for progress. The game must respond to editor changes in blueprint immediately on restart. Never access parent/top/opener except the provided STUDIO API. No fetch, storage, external links, workers, dynamic scripts or DOM navigation. Do not modify Content Security Policy. Describe unimplemented requests honestly in notes. checklist is a proposed manual playtest checklist, NOT claims tests passed. When revising, preserve other behaviour and use existing code as context.`, {
    blueprint, settings: project.settings, availableAssets: Object.keys(project.assets || {}), previousCode: change ? project.code : undefined, requestedChange: change || 'Build the full game from this blueprint.',
  }, signal);
  if (typeof result.code !== 'string' || result.code.length < 500 || result.code.length > 180000) throw new ProviderError('Generated game code is missing or exceeds the supported size.');
  // Syntax check only. Never execute generated code in the server process.
  try { new Function(result.code); } catch { throw new ProviderError('Generated game has a JavaScript syntax error. Retry or use the repair action.'); }
  return result;
}
export async function generateAsset(asset, blueprint, previous, signal) {
  if (asset.kind === 'image') {
    if (!process.env.OPENAI_API_KEY) throw new ProviderError('Add OPENAI_API_KEY.', 503);
    const model = process.env.STUDIO_IMAGE_MODEL || 'gpt-image-1.5';
    const prompt = `${blueprint.artDirection}. Game asset: ${asset.prompt}. Match the project's visual style. No watermarks, labels or UI.`;
    let body, endpoint;
    if (previous) {
      body = new FormData(); body.set('model', model); body.set('prompt', prompt); body.set('size', '1024x1024'); body.set('quality', 'medium');
      body.set('image', new Blob([previous], { type: 'image/png' }), 'reference.png'); endpoint = 'edits';
    } else {
      endpoint = 'generations'; body = JSON.stringify({ model, prompt, size: '1024x1024', quality: 'medium', n: 1, background: asset.role === 'background' ? 'opaque' : 'transparent' });
    }
    const response = await request(`https://api.openai.com/v1/images/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...(previous ? {} : { 'Content-Type': 'application/json' }) }, body }, signal);
    const data = await response.json();
    if (!data.data?.[0]?.b64_json) throw new ProviderError('Image provider returned no image bytes.');
    return { bytes: Buffer.from(data.data[0].b64_json, 'base64'), mime: 'image/png', extension: 'png' };
  }
  if (!process.env.ELEVENLABS_API_KEY) throw new ProviderError('Add ELEVENLABS_API_KEY.', 503);
  const music = asset.kind === 'music';
  const response = await request(`https://api.elevenlabs.io/v1/${music ? 'music' : 'sound-generation'}`, {
    method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(music ? { prompt: asset.prompt, music_length_ms: Math.round(asset.duration * 1000), force_instrumental: true, model_id: process.env.STUDIO_MUSIC_MODEL || 'music_v1' } : { text: asset.prompt, duration_seconds: asset.duration, model_id: 'eleven_text_to_sound_v2' }),
  }, signal);
  if (!(response.headers.get('content-type') || '').startsWith('audio/')) throw new ProviderError('Audio provider returned an unexpected format.');
  return { bytes: Buffer.from(await response.arrayBuffer()), mime: 'audio/mpeg', extension: 'mp3' };
}
