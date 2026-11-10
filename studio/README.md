# ArcadeX AI Game Studio

A new private studio at `/studio`, separate from the legacy generator. Existing wallet/game APIs are unchanged.

## Local setup

Requires Node.js 22+ (native fetch, FormData, AbortSignal.any) and npm.

1. Add entries from [the environment example](../.env.studio.example) to the root `.env`. Do not overwrite your existing settings.
2. Set `STUDIO_ACCESS_KEY` to a random secret of at least 24 characters. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Add `OPENAI_API_KEY` (planning, code, art) and `ELEVENLABS_API_KEY` (music and SFX). Keys remain on the worker. Never use `VITE_` for these keys. Model IDs are configurable.
4. Terminal one: `npm run studio:server`.
5. Terminal two: `npm run dev`.
6. Open `http://localhost:5173/studio` and enter your **studio access key**, not a provider key.

Key presence is shown in connection status; model permissions, billing and quotas are validated by the provider on actual requests. No paid call happens on connection or when opening the reference project.

## Workflow

- Describe the game, select its genre, structure (1–10 levels or endless), art style, difficulty, controls, progression, bosses, story and audio.
- Create a structured blueprint. Review its art prompts and asset counts before spending on assets.
- Generate all missing assets or individual assets. Each request can be billed. A completed asset is saved before the next starts; retry skips completed assets. PNG regeneration sends the current PNG as an editing reference.
- Generate a playable Phaser program. Missing assets receive procedural fallbacks. The model is instructed to use the editable blueprint and implement complete game flow, but output quality and playability need review.
- Playtest in a script-only opaque-origin iframe. Runtime errors appear below the preview and can accompany an AI repair request. No automated claim of playability or balance is made.
- Edit level objects by dragging or entering properties; edit player stats and project JSON. Save and restart preview to apply data/asset edits. Use AI code revisions for new mechanics.
- Replace assets with PNG/JPEG/WebP or MP3/WAV/OGG files under 8 MB. SVG is intentionally unsupported.
- Restore the latest 10 snapshots. Old asset files remain so snapshots can refer to them. No automatic garbage collection currently exists.
- Export/import `.arcadex.json` projects with embedded media, or export a self-contained playable HTML including Phaser. Browser save progress in HTML is best-effort and per browser/origin.

The three-level Emberfall reference is hand-authored, **not** a pre-generated AI response. It exercises combat, double jumping, boss gating, level transitions, saves and editing with procedural art. Opening it works without APIs. Edits to the unsaved reference are in memory; export them or connect and save a workspace copy.

## Runtime contract

Generated JavaScript receives `window.STUDIO`:

```js
{ blueprint, settings, assets, initialLevel, save(value), load() }
```

`assets` maps stable IDs to data URLs. Coordinates describe object centers. Source must read level positions and player values from `blueprint`, create `Phaser.Game` under `#game`, and handle absent assets. Sprite-sheet/frame animation generation is not implemented: generated assets are single images; runtime can animate transforms/tweens. Edit code if a model violates the contract.

The host only accepts runtime messages from its iframe and an instance channel. Save payloads are bounded; provider secrets, access keys and wallet state are never injected. CSP blocks resource/network loads beyond embedded assets and inline scripts. Generated code is syntax-checked but never executed server-side. A hostile or stuck infinite loop can still make a browser tab unresponsive: browser-level execution limits are a future requirement.

## Storage, jobs and deployment

This first release is a **private single-workspace** development service, protected by a separate shared access secret. It is not a public multi-tenant SaaS release. The secret grants access to all projects and paid generation in this workspace; only trusted operators should have it.

Data lives in gitignored `.studio-data/` (or `STUDIO_DATA_DIR`), on the machine running the worker. Writes use temporary-file rename. One worker processes jobs sequentially, with a queue bounded at five and up to 18 assets/project. Do not run multiple worker processes on the same directory. Use a persistent disk and backups. Never commit project data or secrets.

Jobs survive tab closure while the worker runs. After a process restart, unfinished jobs are marked interrupted and require an explicit retry; requests are not silently repeated because provider work may already be billed. Cancellation aborts the local request but cannot guarantee the provider has stopped billing. Do not expose the worker until HTTPS and reverse proxy configuration are in place.

Vite proxies `/api/studio` to loopback port 3002 in development. The current Vercel static/frontend deployment does **not** start this worker. For deployment, run the worker on a persistent Node host and reverse-proxy `/api/studio/*` to it on the same public origin. This service deliberately does not put long-running generation inside the existing Vercel functions. Custom ports require matching Vite proxy configuration.

Before public access: per-user auth/ownership, distributed queues/storage, durable quotas and spending controls, billing, isolated execution limits, asset licensing review, cloud backups and broader generated-game evaluations are still required. Cloud sync, public publishing, skeletal/frame animation generation and automatic gameplay verification are not shipped here.

## Verification

`npm run studio:test` runs real HTTP integration tests with mocked provider responses (zero paid calls), including authentication, invalid blueprints, persistence, partial failure/checkpoint resume, building, version restoration, provider refusal/truncation and worker restart recovery. `npm run build` checks frontend integration. Live provider generation must be tested after credentials are configured.

Provider references: [OpenAI Responses](https://developers.openai.com/api/docs/guides/text), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [image generation/editing](https://developers.openai.com/api/docs/guides/image-generation), [ElevenLabs music](https://elevenlabs.io/docs/api-reference/music/compose), [sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert).
