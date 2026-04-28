# Agent Handoff

Date: 2026-04-27 local / 2026-04-28 UTC.

## Workspace State

- Primary mod repo: `/srv/stfc-mod`, branch `feature/battle-log-decoder`.
- Sidecar repo: `/srv/stfc-mod-sidecar`, branch `feature/basic-log-viewer`.
- Live Windows feed from WSL: `/mnt/c/Games/Star Trek Fleet Command/default/game/community_patch_battle_feed.jsonl`.
- Sidecar server target: `http://127.0.0.1:43127`.

## Completed Today

- AXF Windows interop cycle was already working before this handoff.
- Sidecar was started from WSL against the live Windows feed.
- WSL path normalization was added so default `C:\Games\...` feed paths resolve to `/mnt/c/...`.
- Prime parity-plus is considered achieved for the current attack rows.
- Attack scalar follow-up was captured in Lex as `frame-1777346997111-af6c837d-f1da-471f-9fef-59ef2a55c773`.
- Repeatable scalar analysis script added: `npm run analyze:attack-scalars`.

## Open Battle Analytics Work

- Do not rename `damage.unknownScalarA` or `damage.unknownScalarB` yet.
- Needed evidence: Prime CSV rows for the same battle ID and battle-event index showing:
  - `Mitigated Isolytic Damage`
  - `Mitigated Apex Barrier`
  - `Charging Weapons %`
- If Prime rows are unavailable, use controlled captures where one mechanic changes at a time.

## Sidecar Scale Direction

The viewer should not ship or render full battle payloads for every listed JSONL line on page load. The first practical fix has been implemented as a lightweight index/detail split:

- `/api/events` returns summary/index entries for the recent line window.
- The browser fetches full line details only when an event or battle is selected.
- A later ingest pipeline should tail the JSONL once, normalize into a bounded local store, and let the UI query that store instead of repeatedly rereading and reparsing the large feed.

## Suggested Ingest Pipeline Shape

- One feed-reader task owns file tailing and append detection.
- Parsed events enter a bounded queue with type, battle ID, line number, byte offset, and summary.
- Heavy battle details are parsed off the UI path by a worker queue.
- Pressure valve: when backlog or memory crosses a limit, keep the newest index entries, preserve raw offsets, and defer/drop expensive derived detail work first.
- Store raw line offsets so selected details can be rehydrated from disk even if derived cache entries are evicted.
- Keep all APIs read-only and localhost-only.
