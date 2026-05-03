# STFC Mod Sidecar

STFC Mod Sidecar is a local diagnostic console and integration bridge for the STFC Community Mod. The mod should observe game/mod state and emit structured events. The sidecar should ingest those events, parse battle logs, keep a local session timeline, expose diagnostics, and prepare future integration surfaces.

This project is intentionally separate from the community mod repo because it has a different lifecycle and may eventually use desktop tooling such as Electron, Tauri, Overwolf, or a plain local service. The mod should not grow UI/runtime dependencies just to support diagnostics.

## What This Is

- Read-only diagnostics for structured mod events.
- A boring JSONL event protocol for v0.
- A simple, defensive battle-log parser.
- A place to model hook health, session timeline, and diagnostic bundle exports.
- A future bridge for user-initiated integrations such as Majel, spocks.club, stfc.space, or an optional overlay host.

## What This Is Not

- No auto-clicking.
- No keystroke or mouse input injection into STFC.
- No combat, navigation, claiming, or account automation.
- No hidden advantage logic.
- No sidecar commands that control gameplay.

## Architecture Boundary

The C++ community mod remains the production mod until a managed BepInEx port proves replacement parity in writing. The sidecar stays mod-agnostic and communicates through local files and documented APIs, not implementation internals. See [docs/12-production-mod-boundary.md](docs/12-production-mod-boundary.md).

The current C++ mod feed contract is documented in [docs/13-cpp-mod-feed-contract.md](docs/13-cpp-mod-feed-contract.md).

The V1 hotkey settings page decisions are documented in [docs/14-hotkey-settings-page.md](docs/14-hotkey-settings-page.md).

## V0 Goals

- Ingest JSONL events emitted by the community mod.
- Define event types for debug, hook health, battle, session, and integration activity.
- Parse plain-text battle-log lines while preserving raw input.
- Mark unknown or unparsed battle-log lines explicitly.
- Build an exportable diagnostic bundle shape.
- Keep desktop UI and overlay choices replaceable.

## Architecture Sketch

```text
Community Mod
  observes game/mod state
  emits structured JSONL events
  does not own UI or external integrations

Sidecar Core
  ingests events
  parses battle logs
  stores session timeline
  exports diagnostics
  exposes a local API later

Desktop UI / Overwolf UI
  renders logs, battle view, hook health, and timeline
  consumes sidecar core events
  remains replaceable
```

## Planned Phases

1. V0 core: event types, JSONL helpers, parser, tests, docs.
2. File ingestion: live-ish tailing of JSONL and battle-log files.
3. Local storage: session timeline and diagnostic bundle export.
4. Local API: localhost HTTP, WebSocket, or named pipe after JSONL proves useful.
5. UI shell: desktop diagnostics viewer.
6. Optional overlay host: evaluate Overwolf as a renderer only.

## Project Layout

```text
docs/                  planning and protocol notes
examples/              placeholder JSONL and battle-log samples
packages/core/         TypeScript event model, parser, diagnostics helpers
packages/desktop/      placeholder for a future UI shell
packages/viewer/       local browser viewer for JSONL feed inspection
```

## Development

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Build TypeScript:

```bash
npm run build
```

Run both:

```bash
npm run check
```

## Log Viewer

Start the managed local viewer against the live STFC feed:

```bash
npm run viewer
```

Then open `http://127.0.0.1:43127`.

The root route is now the viewer home page. The current battle-log tool lives at `http://127.0.0.1:43127/battle-log/`.

Server control commands:

```bash
npm run server:status
npm run server:stop
npm run server:kill
npm run server:restart
npm run server:logs
```

Run the same UI against the sample feed:

```bash
npm run viewer:sample
```

Override the feed path or port on start or restart:

```bash
npm run viewer -- --feed-path "C:\Games\Star Trek Fleet Command\default\game\community_patch_battle_feed.jsonl" --port 43128 --limit 250
npm run server:restart -- --port 43128 --limit 250
```

Run the viewer in the foreground for direct debugging:

```bash
npm run viewer:run
```

Detailed operating notes live in `docs/07-log-viewer.md`.

Battle-log parser and analyzer requirements live in `docs/11-battle-log-parser-analyzer-requirements.md`.

## Desktop Companion Packaging

The optional desktop companion lives in `packages/desktop/`. It wraps the same
local viewer UI in Electron, starts the sidecar server as a bundled local child
process, and opens the LCARS-inspired companion shell in a desktop window.

After installing dependencies, run the desktop shell in development:

```bash
npm run desktop:dev
```

Create an unpacked app directory for inspection:

```bash
npm run desktop:pack
```

Create release artifacts:

```bash
npm run desktop:dist
```

Create Windows artifacts only:

```bash
npm run desktop:dist:win
```

Electron must stay on a release line with Node 22 or newer because the sidecar
event store uses Node's `node:sqlite` module. The desktop package currently
targets Electron 41, which carries Node 24.

Local desktop artifacts are unsigned by default. Official Windows signing uses
Azure Artifact Signing through the release workflow and is documented in
[docs/16-windows-code-signing.md](docs/16-windows-code-signing.md).

The desktop app can remember a selected STFC game directory and pass it to the
bundled sidecar server. User bootstrap/path behavior is documented in
[docs/17-user-bootstrap-and-paths.md](docs/17-user-bootstrap-and-paths.md).

## Battle-Log Samples

The files in `examples/` are placeholders for parser development. Real STFC battle-log samples should be added later under a reviewable sample area, with account names, IDs, coordinates, alliance tags, and timestamps redacted when needed. Keep private/raw samples out of Git by using `samples/private/`.

The parser should only become more specific when real log shapes justify it.
