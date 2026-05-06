# Sidecar Changelog

## Unreleased

### Changed

- Began first-class Community Mod variant gates: profile definitions are now
  shared on the viewer/desktop side, new-user profile intent defaults to
  Official Basic, and runtime Battle Log gates require both selected intent and
  installed DLL capability.
- Added a session-only Security Is Paramount warning when the selected profile
  and installed DLL variant differ, or when the installed DLL is unknown.
- Hid the Home-page Workbench card unless Battle Log capability is available,
  even when Developer Tools are enabled.

### Fixed

- Public Battle Log URLs now render a Companion unavailable page in Basic mode
  instead of exposing the raw profile-capability JSON response.

## 0.1.0-alpha.3 - 2026-05-05

### Fixed

- Made capability-gated renderer surfaces fail closed until the active profile
  explicitly enables them, preventing Basic mode from briefly showing Battle Log
  actions during startup or mode switches.

## 0.1.0-alpha.2 - 2026-05-05

### Features

- Added a primary `Install Community Mod` About-page action that selects the
  game directory when needed, checks GitHub release metadata, verifies and
  stages the DLL, and then prompts for the final install/update confirmation.
- Enabled guarded Community Mod install/uninstall execution for the
  desktop-managed local server while keeping token and confirmation checks in
  place.
- Added Companion app uninstall status and desktop handoff actions: installed NSIS
  copies can launch their uninstaller, packaged copies can open Windows Apps, and
  portable/source runs no longer show a misleading app-uninstall action.

### Docs

- Extended the release QA matrix with Companion app uninstall handoff and
  Community Mod/app uninstall separation checks.
- Reworked the README for public alpha onboarding with download, first-run,
  install, uninstall, and alpha expectation guidance.

## 0.1.0-alpha.1 - 2026-05-05

### Architecture

- Established hybrid storage model: append-only JSONL feed for basic/zero-dependency
  installs; HTTP ingest + SQLite (or PostgreSQL) for full SQL-backed deployments
- Sidecar is now the canonical owner of all local storage — the mod exports only,
  it does not write or manage files

### Features

- Polished the LCARS shell header alignment and removed an unsupported Safari
  scrollbar compatibility warning from the shared viewer CSS.
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
- Added Community Mod install recovery guidance plus a temp-directory install execution smoke for guarded install/replace receipts.
- Added full-uninstall groundwork with extended sidecar install manifest metadata plus Community Mod uninstall plan, confirmation, execution, optional settings/log cleanup, and About-page controls. Unknown/manual uninstall removes `version.dll` directly instead of retaining a DLL backup.
- Added a dev-copy Community Mod reinstall smoke that drives the local viewer API, verifies uninstall creates no DLL backup, preserves settings/log artifacts, and reinstalls official Basic.
- Added Advanced Alpha install support for Guffawaffle tagged releases plus a dev-copy reinstall smoke option for the latest Guffawaffle release.
- Added local capability-token protection for Community Mod install/uninstall/release/artifact endpoints, explicit GitHub network-consent headers for release/artifact calls, and per-game-directory operation locking for install/uninstall writes.
- Hardened Community Mod artifact handling to fail closed when trusted SHA-256 release metadata is missing and to recheck cached artifact hashes before staging.
- Hardened Community Mod install/uninstall execution with realpath/lstat path checks, symlink blocking, split install/uninstall execution environment gates, and an accessible About-page confirmation dialog for destructive actions.
- Simplified the About-page Community Mod card so `Uninstall` is a primary action that prepares, confirms, and executes the correct uninstall flow while keeping detailed step controls under diagnostics.
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

- Added Basic companion milestone closeout notes and identified full uninstall as
  the planned next milestone.
- `docs/05-integration-plan-for-community-mod.md` updated with dual-mode
  architecture and `battlelogs_realtime` target model
- Added `docs/12-battle-analytics-followups.md` for post-parity follow-up tracking
- Added `docs/13-agent-handoff.md` session handoff note (2026-04-27/28)
