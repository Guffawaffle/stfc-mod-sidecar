# Log Viewer

The sidecar includes a multipage local viewer for battle events emitted by `stfc-mod`. The canonical runtime path is authenticated local `POST /api/sidecar/ingest` into the sidecar-owned SQL event store. JSONL remains available only for diagnostics, evidence capture, and replay/import workflows when explicitly enabled.

## What It Does

- Reads the local sidecar SQL event store first.
- Can read an explicit JSONL evidence or replay source when that source is present.
- Uses `/` as a viewer home page and `/battle-log/` as the dedicated battle-log tool route.
- Uses `/battle-log/workbench/` as the local Battle Workbench route for grouped battle analysis.
- Shows the most recent battle events in a browser.
- Highlights `battle.capture`, `battle.report`, `battle.analytics`, and `catalog.snapshot` payloads with focused detail panels plus raw JSON.
- Loads Workbench battle lists through the lightweight `/api/battles` index and loads full detail lazily through `/api/battles/{battleId}` only after selection.
- Tracks read/unread state locally and does not move the selected event during refresh.
- Stays read-only. It does not send commands to the game or the mod.

## Durable Store

Desktop launches set `STFC_SIDECAR_STORE_CONNECTION` to the Electron `userData` directory, for example:

`%APPDATA%\STFC Community Mod Companion\sidecar-events.sqlite`

The viewer server still supports overriding this with `STFC_SIDECAR_STORE_CONNECTION`, and `STFC_SIDECAR_STORE_BACKEND=postgres` can point at `STFC_SIDECAR_STORE_CONNECTION` or `DATABASE_URL` for shared-store development.

Accepted `battle.events` payloads from `/api/sidecar/ingest` land here first; this is the durable runtime store used by the normal Companion flow.

SQLite is the normal packaged runtime event store. JSONL files are diagnostics, fallback, replay, or evidence artifacts; they are not the primary Battle Log or Workbench source when the SQL store is active.

## Optional JSONL Evidence Or Replay Path

When explicit JSONL evidence capture or replay is in use, a common game feed path is:

`C:\Games\Star Trek Fleet Command\default\game\community_patch_battle_feed.jsonl`

That file is written by `stfc-mod` only when local JSONL logging is explicitly enabled under `[sidecar.logging]`. The viewer reads JSONL only when you explicitly pass `--feed-path` or set `STFC_SIDECAR_FEED_PATH`. Normal runtime data should arrive through `/api/sidecar/ingest` and persist in the sidecar-owned SQL store.

## Start The Viewer

From the sidecar repo root:

```powershell
npm run viewer
```

Then open:

`http://127.0.0.1:43127`

From there, open the Battle Log page, or navigate directly to:

`http://127.0.0.1:43127/battle-log/`

The managed start command builds the sidecar core package first, launches the viewer in the background, records its pid in `.sidecar/viewer-server.json`, and writes bounded process logs to `.sidecar/viewer-server.log`. Treat that file as a local troubleshooting log, not as durable telemetry.

By default, this starts the viewer without a JSONL feed. Battle Log and Workbench reads use the sidecar event store unless an explicit JSONL replay/import feed is configured.

## Server Control Commands

Use these commands to manage the viewer process:

```powershell
npm run server:status
npm run server:stop
npm run server:kill
npm run server:restart
npm run server:logs
```

The control layer adds these operating features:

- pid tracking for the launched viewer process
- no dual launch when a managed or already-listening viewer exists on the target port
- graceful shutdown through a launch-scoped local shutdown token
- force kill when the server is hung or graceful shutdown is unavailable
- restart that reuses the previous launch arguments unless you override them
- stale pid cleanup if the recorded process no longer exists
- startup readiness checks against `/api/health`
- persisted viewer logs for post-failure inspection

## Sample Mode

To run the viewer against the sample JSONL file as an explicit replay/import source:

```powershell
npm run viewer:sample
```

## Override The Feed Path

Command-line override:

```powershell
npm run viewer -- --feed-path "C:\path\to\another-feed.jsonl"
```

Environment override:

```powershell
$env:STFC_SIDECAR_FEED_PATH = "C:\path\to\another-feed.jsonl"
npm run viewer
```

## Override Port Or Line Limit

Command-line:

```powershell
npm run viewer -- --port 43128 --limit 250
npm run server:restart -- --port 43128 --limit 250
```

Environment:

```powershell
$env:STFC_SIDECAR_PORT = "43128"
$env:STFC_SIDECAR_LIMIT = "250"
npm run viewer
```

## Basic Operating Flow

1. Make sure `stfc-mod` is configured for local `[sidecar.sync]` ingest:
   - `battlelogs_realtime = true` enables raw/capture battle transport.
   - `battlelog_enrichment = true` enables `battle.report`, `catalog.snapshot`, and `battle.analytics`.
   - `fleet_runtime = true` enables fleet projection updates.
   Existing legacy native `[sync]` categories remain separate and are not replaced by `[sidecar.sync]`.
2. Start the viewer with `npm run viewer`.
3. Use `npm run server:status` to confirm the managed pid, port, and selected local paths. `/api/health` also reports the active event-store backend.
4. Open the Battle Log page from the home page, or jump directly to `/battle-log/`.
5. Kill hostiles or trigger battle activity in STFC.
6. Watch new `battle.capture`, `battle.report`, `battle.analytics`, and `catalog.snapshot` records appear in the event list.
7. Click an event to inspect tokens, participants, rewards, CSV parity rows, catalog coverage, and raw JSON.

## Multipage Direction

The root page should stay lightweight and act as a stable entrypoint for viewer modules.

Current page layout:

- `/`: viewer home and module selection
- `/battle-log/`: battle log explorer
- `/battle-log/workbench/`: parser and analyzer workbench staging page
- `/fleet/`: local fleet runtime projection view
- `/diagnostics/cloud-sync/`: Majel/cloud envelope monitoring; this is not local ingest validation

Recommended next pages:

- `/integrations/`: export and provider status
- `/sessions/`: feed health and session diagnostics

Requirements for the future battle-log workbench are tracked in `docs/11-battle-log-parser-analyzer-requirements.md`.

## Foreground Debugging

If you need the original attached process behavior for direct console debugging, run:

```powershell
npm run viewer:run
```

## Notes

- Validate local sidecar ingest with `/api/health`, `/api/events`, `/api/battles`, `/battle-log/`, `/battle-log/workbench/`, and `/fleet/`.
- `GET /api/events` returns event snapshots. Use `detail=summary` for lightweight lists and fetch selected event detail only when needed.
- `GET /api/battles?limit=N` returns a lightweight battle index for grouped Workbench lists and dropdowns. It must not include giant raw battle payloads.
- `GET /api/battles/{battleId}` returns the full lazy detail for a selected battle.
- The Battle Log and Workbench pages use `GET /api/events/stream` for live update hints; accepted
  `/api/sidecar/ingest` batches broadcast lightweight refresh/invalidation hints immediately, and the server also watches any configured JSONL evidence/replay source when that source is in use.
- SSE should carry small notifications such as new/updated battle index entries, catalog availability, analytics availability, fleet projection advancement, or store status. Do not push full raw battlelogs through SSE by default.
- If browser EventSource support or the stream connection fails, the page keeps
  a slow fallback refresh so the viewer degrades without returning to the old
  two-second polling loop.
- The page only displays the latest window of lines that you request in the control bar.
- Invalid or non-sidecar JSONL lines are kept visible with an error note instead of being dropped silently during diagnostics or replay work.
