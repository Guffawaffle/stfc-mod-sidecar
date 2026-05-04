# Sidecar Changelog

## Unreleased

### Architecture

- Established hybrid storage model: append-only JSONL feed for basic/zero-dependency
  installs; HTTP ingest + SQLite (or PostgreSQL) for full SQL-backed deployments
- Sidecar is now the canonical owner of all local storage — the mod exports only,
  it does not write or manage files

### Features

- Added initial Community Mod settings schema profiles so official netniV Basic mode can hide fork-only settings before broader settings editing expands.
- Added a desktop Settings profile selector for switching between official Basic and Advanced Alpha schemas.
- Added Community Mod DLL install detection to classify missing, official Basic, advanced, and unknown installs by manifest/hash evidence.
- Added Basic profile capability gates so Battle Log navigation, APIs, feed watching, and event storage stay off for official Basic mode.
- Added a Community Mod release catalog endpoint for profile-specific mod artifact selection without downloading or installing yet.
- Added About and Settings status surfaces for installed Community Mod provenance and profile release metadata.
- Added a dry-run Community Mod install/update plan endpoint and About-page plan status without enabling DLL writes yet.
- Added cached Community Mod artifact verification with SHA-256 and zip structure checks, still without game-directory writes.
- Added a Community Mod install preflight endpoint that checks plan, artifact
  verification, and `prime.exe` status before any write path exists.
- Added cache-only Community Mod `version.dll` staging from verified artifacts without writing into the game directory.
- Added a Community Mod install confirmation contract that plans destination, backup, and staged hash details while DLL copy execution remains disabled.
- Added a guarded Community Mod install execution helper with execution-time process checks, staged-hash verification, backup/copy/hash verification, and manifest receipts tested only against temp directories.
- Added a guarded Community Mod install execution endpoint that remains process-disabled by default and requires explicit request acknowledgement, staged hash, and destination confirmation before write handling.
- Added an About-page Community Mod Execute Install flow that posts the prepared confirmation payload to the guarded endpoint and reports blocked/completed execution receipts.
- Added a platform compatibility guard so non-Windows Community Mod install/update flows report unsupported instead of probing or executing the Windows `version.dll` path.
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
