// The editable document is the source of truth for both the editor and runtime.
export const GENRES = ['Action platformer', 'Top-down adventure', 'Arena survival', 'Space shooter', 'Puzzle adventure'];
export const STYLES = ['Illustrated fantasy', 'Pixel art', 'Cartoon', 'Dark atmospheric', 'Neon sci-fi'];
export const DEFAULT_SETTINGS = { genre: GENRES[0], structure: 'levels', levelCount: 3, style: STYLES[0], difficulty: 'Balanced', controls: 'Desktop + touch', bosses: true, upgrades: true, story: true, music: true, sfx: true };
const string = { type: 'string' };
const number = { type: 'number' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = items => ({ type: 'array', items });
export const blueprintSchema = object({
  title: string, pitch: string, artDirection: string, story: string,
  mechanics: array(string), controls: array(string),
  player: object({ speed: number, jump: number, health: number, damage: number }),
  levels: array(object({ id: string, name: string, objective: string, width: number, height: number, background: string,
    entities: array(object({ id: string, type: { type: 'string', enum: ['spawn', 'platform', 'enemy', 'boss', 'coin', 'exit', 'decoration'] }, x: number, y: number, width: number, height: number, assetId: string })) })),
  assets: array(object({ id: string, name: string, kind: { type: 'string', enum: ['image', 'music', 'sfx'] }, role: string, prompt: string, duration: number })),
});
export const buildSchema = object({ code: string, notes: string, checklist: array(string) });
export function validateBlueprint(b, settings) {
  if (!b || typeof b.title !== 'string' || !b.title.trim() || b.title.length > 160 || typeof b.pitch !== 'string' || typeof b.artDirection !== 'string' || typeof b.story !== 'string') throw new Error('Blueprint is missing its title or art direction.');
  for (const key of ['mechanics', 'controls']) if (!Array.isArray(b[key]) || b[key].length > 30 || b[key].some(x => typeof x !== 'string' || x.length > 2000)) throw new Error(`Invalid ${key}.`);
  if (!b.player || !['speed', 'jump', 'health', 'damage'].every(k => Number.isFinite(b.player[k]) && b.player[k] > 0 && b.player[k] <= 2000)) throw new Error('Player values must be between 0 and 2000.');
  if (!Array.isArray(b.levels) || b.levels.length < 1 || b.levels.length > 10 || (settings?.structure === 'levels' && b.levels.length !== settings.levelCount)) throw new Error('Blueprint level count does not match your setup (1–10 levels).');
  if (!Array.isArray(b.assets) || b.assets.length > 18) throw new Error('A project can have up to 18 generated assets.');
  const ids = new Set();
  for (const a of b.assets) {
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(a.id) || ids.has(a.id)) throw new Error('Asset IDs must be unique lowercase identifiers.');
    ids.add(a.id);
    if (!['image', 'music', 'sfx'].includes(a.kind) || typeof a.prompt !== 'string' || !a.prompt.trim() || a.prompt.length > 3500 || typeof a.name !== 'string' || typeof a.role !== 'string' || !Number.isFinite(a.duration)) throw new Error('Invalid asset description.');
    if (a.kind === 'music' && (a.duration < 3 || a.duration > 60)) throw new Error('Music must be 3–60 seconds per asset.');
    if (a.kind === 'sfx' && (a.duration < 0.5 || a.duration > 10)) throw new Error('Sound effects must be 0.5–10 seconds.');
  }
  const levelIds = new Set();
  for (const l of b.levels) {
    if (typeof l.id !== 'string' || levelIds.has(l.id) || typeof l.name !== 'string' || typeof l.objective !== 'string' || typeof l.background !== 'string' || (l.background && !ids.has(l.background))) throw new Error('Invalid level identity or background asset.');
    levelIds.add(l.id);
    if (!Number.isFinite(l.width) || !Number.isFinite(l.height) || l.width < 960 || l.width > 12000 || l.height < 540 || l.height > 4000 || !Array.isArray(l.entities) || l.entities.length > 150) throw new Error('Invalid level dimensions or object count.');
    const entityIds = new Set();
    for (const e of l.entities) {
      if (typeof e.id !== 'string' || entityIds.has(e.id) || !['spawn', 'platform', 'enemy', 'boss', 'coin', 'exit', 'decoration'].includes(e.type) || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(e[k])) || e.x < 0 || e.y < 0 || e.x > l.width || e.y > l.height || e.width <= 0 || e.height <= 0 || e.width > l.width || e.height > l.height || typeof e.assetId !== 'string' || (e.assetId && !ids.has(e.assetId))) throw new Error('Invalid level object or asset reference.');
      entityIds.add(e.id);
    }
    if (!l.entities.some(e => e.type === 'spawn') || !l.entities.some(e => e.type === 'exit')) throw new Error('Every level needs a spawn and exit.');
  }
  return b;
}
export function validateSettings(s) {
  if (!s || !GENRES.includes(s.genre) || !STYLES.includes(s.style) || !['levels', 'endless'].includes(s.structure) || !Number.isInteger(s.levelCount) || s.levelCount < 1 || s.levelCount > 10 || !['Relaxed', 'Balanced', 'Challenging'].includes(s.difficulty) || !['Desktop', 'Desktop + touch'].includes(s.controls) || !['bosses', 'upgrades', 'story', 'music', 'sfx'].every(k => typeof s[k] === 'boolean')) throw new Error('Invalid game setup.');
  return { ...s, levelCount: s.structure === 'endless' ? 1 : s.levelCount };
}
