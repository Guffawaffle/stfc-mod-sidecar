# Log Viewer

The sidecar now includes a multipage local viewer for the JSONL data emitted by `stfc-mod` when local JSONL fallback capture is explicitly enabled.

## What It Does

- Reads the mod feed file directly from disk.
- Uses `/` as a viewer home page and `/battle-log/` as the dedicated battle-log tool route.
- Shows the most recent JSONL events in a browser.
- Highlights `battle.capture`, `battle.report`, `battle.analytics`, and `catalog.snapshot` payloads with focused detail panels plus raw JSON.
- Stays read-only. It does not send commands to the game or the mod.

## Default Feed Path

By default the viewer reads:

`C:\Games\Star Trek Fleet Command\default\game\community_patch_battle_feed.jsonl`

That is the structured feed written by the battle-log decoder path in `stfc-mod` when `sync.sidecar_jsonl` is enabled. Preferred durable export remains ingress-first through sidecar or another configured consumer.

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

To run the viewer against the sample JSONL file instead of the live game feed:

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

1. Make sure `stfc-mod` is running with `[battle_log_decoder].enabled = true` and `emit_feed = true`.
2. Start the viewer with `npm run viewer`.
3. Use `npm run server:status` to confirm the managed pid, port, and feed path.
4. Open the Battle Log page from the home page, or jump directly to `/battle-log/`.
5. Kill hostiles or trigger battle activity in STFC.
6. Watch new `battle.capture`, `battle.report`, `battle.analytics`, and `catalog.snapshot` lines appear in the event list.
7. Click an event to inspect tokens, participants, rewards, CSV parity rows, catalog coverage, and raw JSON.

## Multipage Direction

The root page should stay lightweight and act as a stable entrypoint for viewer modules.

Current page layout:

- `/`: viewer home and module selection
- `/battle-log/`: battle log explorer
- `/battle-log/workbench/`: parser and analyzer workbench staging page

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

- The Battle Log page uses `GET /api/events/stream` for live update hints; the
  server watches the JSONL feed and tells the page when to refresh its snapshot.
- If browser EventSource support or the stream connection fails, the page keeps
  a slow fallback refresh so the viewer degrades without returning to the old
  two-second polling loop.
- The page only displays the latest window of lines that you request in the control bar.
- Invalid or non-sidecar JSONL lines are kept visible with an error note instead of being dropped silently.
