# Log Viewer

The sidecar now includes a basic local viewer for the JSONL data emitted by `stfc-mod`.

## What It Does

- Reads the mod feed file directly from disk.
- Shows the most recent JSONL events in a browser.
- Highlights `battle.report` summaries, participants, rewards, and raw JSON.
- Stays read-only. It does not send commands to the game or the mod.

## Default Feed Path

By default the viewer reads:

`C:\Games\Star Trek Fleet Command\default\game\community_patch_battle_feed.jsonl`

That is the structured feed written by the battle-log decoder path in `stfc-mod`.

## Start The Viewer

From the sidecar repo root:

```powershell
npm run viewer
```

Then open:

`http://127.0.0.1:43127`

The root script builds the sidecar core package first, then starts the viewer server.

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
3. Kill hostiles or trigger battle activity in STFC.
4. Watch new `battle.report` lines appear in the event list.
5. Click an event to inspect participants, rewards, and raw JSON.

## Notes

- The viewer polls the JSONL file every two seconds when auto refresh is enabled.
- The page only displays the latest window of lines that you request in the control bar.
- Invalid or non-sidecar JSONL lines are kept visible with an error note instead of being dropped silently.