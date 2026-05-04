# Sidecar Changelog

## Unreleased

### Architecture

- Established hybrid storage model: append-only JSONL feed for basic/zero-dependency
  installs; HTTP ingest + SQLite (or PostgreSQL) for full SQL-backed deployments
- Sidecar is now the canonical owner of all local storage — the mod exports only,
  it does not write or manage files

### Features

- Added `POST /api/events` ingest endpoint with Bearer token auth
  (`STFC_SIDECAR_SYNC_TOKEN`, or a launch-scoped generated token when unset)
- Added manual `/api/release/check` update checks and About-page release status
- Added canonical SQL event store (`packages/core/src/storage/sql-event-store.ts`)
  - SQLite backend via `node:sqlite` (default; no external dependencies)
  - PostgreSQL backend via `pg` (opt-in via `STFC_SIDECAR_STORE_BACKEND=postgres`)
  - Deduplication by stable event key derived from `(battle_id, event_type, journal_id)`
  - `SidecarEventStore` interface exported from `packages/core/src/index.ts`
- `GET /api/events` now reads from the SQL store when available (`source: "store"`),
  falling back to the JSONL feed index if no store is configured
- Added append-aware JSONL feed index with byte-offset tracking so the server
  never re-reads the entire feed file on each request
- Viewer and workbench UIs updated to reflect store-backed event list

### Infra

- Added `@types/node` and `@types/pg` to dev dependencies
- Extended `tsconfig.base.json` to allow `node:` import specifiers
- SQLite store tests added (`packages/core/src/storage/sql-event-store.test.ts`)
  covering deduplication and stable event-key derivation

### Docs

- `docs/05-integration-plan-for-community-mod.md` updated with dual-mode
  architecture and `battlelogs_realtime` target model
- Added `docs/12-battle-analytics-followups.md` for post-parity follow-up tracking
- Added `docs/13-agent-handoff.md` session handoff note (2026-04-27/28)
