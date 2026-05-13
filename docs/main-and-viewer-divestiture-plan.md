# Main And Viewer Divestiture Plan

This is a modularization plan for shrinking the largest Companion entrypoints without changing product behavior.

## Handoff Status

- Completed: Slice 1 extracted Electron BrowserWindow creation to `packages/desktop/src/main-window.mjs`.
- Completed: Slice 2 extracted sidecar child-process lifecycle to `packages/desktop/src/sidecar-server-process.mjs`.
- Completed: Slice 3 extracted desktop bootstrap IPC registration to `packages/desktop/src/desktop-ipc.mjs`.
- Current `packages/desktop/src/main.mjs` role: Electron app startup, bootstrap snapshot, desktop settings persistence, startup game-directory validation, restart coordination, and release metadata.
- Current `packages/desktop/src/main-window.mjs` role: BrowserWindow construction and direct window behavior only.
- Current `packages/desktop/src/sidecar-server-process.mjs` role: sidecar port probing, process spawn, runtime path resolution, health polling, shutdown, process token state, and release env construction.
- Current `packages/desktop/src/desktop-ipc.mjs` role: desktop bridge IPC channel registration, Developer Tools/profile handlers, game-directory selection/open handlers, and companion app uninstall handoff handlers.
- Last validation run after Slice 3: `node --check packages/desktop/src/main.mjs`, `node --check packages/desktop/src/desktop-ipc.mjs`, `node --check packages/desktop/src/main-window.mjs`, `node --check packages/desktop/src/sidecar-server-process.mjs`, `npm test --workspace @stfc-mod-sidecar/desktop`, `npm run ax -- check`, and `git diff --check`.
- Manual smoke not run yet: `npm run desktop:dev`.
- Next recommended slice: pause desktop extraction for manual `npm run desktop:dev` smoke, then plan the viewer server split in a separate PR.
- Do not start viewer server route splitting until desktop `main.mjs` is smaller and stable.

## Current Monoliths

- `packages/desktop/src/main.mjs` (started at about 674 lines; about 301 lines after Slices 1-3): Electron app startup, desktop settings persistence, bootstrap snapshot construction, startup game-directory validation, restart coordination, release metadata, and logging.
- `packages/viewer/server.mjs` (about 2317 lines): HTTP server setup, route dispatch, local auth checks, GitHub release consent checks, mod install/update/uninstall orchestration routes, settings routes, diagnostics routes, event ingest/read routes, feed watching/indexing, static file serving, and shutdown.
- `packages/viewer/public/about/app.js` (about 1542 lines): About page state, release/update UI, companion uninstall UI, Community Mod install/update/uninstall UI, GitHub consent dialog flow, diagnostics preview/download, settings troubleshooting context, and desktop bootstrap display.
- `packages/viewer/public/settings/app.js` (about 1429 lines): Settings page state, desktop bootstrap controls, profile/developer-mode controls, hotkey editing, hard settings, diagnostics settings, notifications settings, dirty-state tracking, token-gated saves, and capture dialog handling.

## Existing Good Module Boundaries

- `packages/desktop/src/game-directory.mjs`: canonical local STFC game-directory validation and default detection.
- `packages/desktop/src/desktop-settings.mjs`: desktop settings normalization, developer-mode seed parsing, and mod profile normalization.
- `packages/desktop/src/companion-uninstall.mjs`: packaged/portable/source Companion uninstall status and safe direct-child uninstaller checks.
- `packages/viewer/community-mod-install*.mjs` and `packages/viewer/community-mod-uninstall*.mjs`: install/uninstall planning, preflight, confirmation, staging, and execution logic.
- `packages/viewer/community-mod-release-catalog.mjs`: release catalog fetching/profile normalization.
- `packages/viewer/runtime-mode.mjs`: Standard Companion vs Developer Tools mode gating.
- `packages/viewer/local-auth.mjs`: local bearer-token authorization helpers.
- `packages/viewer/public/shared/*`: shared browser-side status labels, page shell, page metadata, and variant-gate rendering.

## Safety-Sensitive Areas

- The Companion must only write inside the selected STFC game directory.
- The selected game directory must validate as a canonical local directory containing `prime.exe` directly inside it.
- Install and uninstall must keep explicit confirmation/token flow.
- GitHub release/network checks must keep explicit consent.
- STFC running from the selected game folder must block install/uninstall.
- Symlinked or unsafe `version.dll` and path-boundary cases must remain blocked.
- Existing/manual `version.dll` installs must require explicit replacement/removal confirmation.
- Standard Companion mode and Developer Tools mode must keep current gating behavior.

## First Safe Extraction Slices

1. Done: extract Electron BrowserWindow creation from `packages/desktop/src/main.mjs` into `packages/desktop/src/main-window.mjs`.
   Keep width, height, minimum sizes, title, background, preload path, context isolation, node integration, sandbox, ready-to-show, external-link handling, and `loadURL` behavior unchanged.
   Tests/checks: `npm test --workspace @stfc-mod-sidecar/desktop`, then `npm run ax -- check`.

2. Done: extract sidecar child-process lifecycle from `packages/desktop/src/main.mjs` into `packages/desktop/src/sidecar-server-process.mjs`.
   Move server startup/shutdown, health polling, runtime path resolution, process exit waiting, and release environment construction only after dependency seams are explicit.
   Tests/checks: `npm test --workspace @stfc-mod-sidecar/desktop`, targeted manual `npm run desktop:dev` smoke if available, then `npm run ax -- check`.

3. Done: extract desktop bootstrap IPC registration from `packages/desktop/src/main.mjs` into `packages/desktop/src/desktop-ipc.mjs`.
   Move only bootstrap, Developer Tools/profile, game-directory, open-directory, devtools status, and companion-uninstall handlers. Pass dependencies explicitly rather than importing mutable globals.
   Tests/checks: `npm test --workspace @stfc-mod-sidecar/desktop`, targeted manual `npm run desktop:dev` smoke if available, then `npm run ax -- check`.

## Later Viewer Server Split

Plan a separate PR for `packages/viewer/server.mjs` now that desktop `main.mjs` is smaller. Keep this as a route-boundary extraction, not a behavior rewrite.

### Target Modules

- `packages/viewer/server/http-server.mjs`
- `packages/viewer/server/routes/health-routes.mjs`
- `packages/viewer/server/routes/settings-routes.mjs`
- `packages/viewer/server/routes/mod-install-routes.mjs`
- `packages/viewer/server/routes/mod-uninstall-routes.mjs`
- `packages/viewer/server/routes/diagnostics-routes.mjs`
- `packages/viewer/server/routes/event-routes.mjs`
- `packages/viewer/server/static-files.mjs`
- `packages/viewer/server/feed-watcher.mjs`

### Route Split Order

1. Static files and response helpers:
   Move `resolvePublicAsset`, `publicPathCandidates`, `isWithinPublicDir`, `contentTypeForPath`, `sendFile`, `sendJson`, and `sendText` into a small static/response module. Keep cache headers, content types, URL decoding, and public-dir path boundary checks unchanged.
   Validation: `npm test --workspace @stfc-mod-sidecar/desktop`, `npm run ax -- check`.

2. Health and shutdown routes:
   Move `/api/health` response construction and `/api/admin/shutdown` handling behind `health-routes.mjs`. Keep shutdown token auth, desktop capability fields, release payload, mode fields, and game/settings/feed path fields unchanged.
   Validation: add or extend route-level tests if a harness exists; otherwise run full desktop tests and `npm run ax -- check`.

3. Settings routes:
   Move `/api/settings/hotkeys`, `/api/settings/notifications`, and `/api/settings/diagnostics`. Keep Developer Tools gating for diagnostics, settings-token requirements, save modes, payload parsing limits, and TOML patch behavior unchanged.
   Validation: existing settings tests plus `npm run ax -- check`.

4. Mod install routes:
   Move `/api/mod/release-catalog`, `/api/mod/install-plan`, `/api/mod/verify-artifact`, `/api/mod/install-preflight`, `/api/mod/install-confirmation`, and `/api/mod/install-execution`. Keep GitHub network consent, mod bearer token auth, operation locks, selected profile normalization, artifact cache path, and all confirmation/execution semantics unchanged.
   Validation: existing install/release/artifact tests plus `npm run ax -- check`.

5. Mod uninstall routes:
   Move `/api/mod/uninstall-plan`, `/api/mod/uninstall-confirmation`, and `/api/mod/uninstall-execution`. Keep delete-settings option, explicit acknowledgement fields, current hash/destination confirmation, STFC process blocking, and operation locks unchanged.
   Validation: existing uninstall tests plus `npm run ax -- check`.

6. Diagnostics routes:
   Move `/api/diagnostics/bundle`. Keep markdown format support, Developer Tools expectations if any are added later, and diagnostic bundle contents unchanged.
   Validation: existing diagnostics tests plus `npm run ax -- check`.

7. Event and fleet routes:
   Move `/api/events`, `/api/events/stream`, and `/api/fleet/sync`. Keep ingest size limits, stream keepalive, event-store revision behavior, detail/summary mode, feed indexing, and cloud telemetry bridge behavior unchanged.
   Validation: existing core/parser/storage tests plus `npm run ax -- check`.

8. Feed watcher:
   Extract watcher setup, debounce, close behavior, and feed index state only after route handlers are already separated. Keep polling hints, JSONL hydration, partial-line behavior, and detail cache size unchanged.
   Validation: add focused feed tests if practical, then `npm run ax -- check`.

### Viewer Split Constraints

- Do not move Community Mod install/uninstall execution internals out of their existing `community-mod-*` modules as part of route splitting.
- Do not change API paths, HTTP methods, response status codes, auth headers, consent headers, or JSON field names.
- Keep Developer Tools and capability gating before route-specific behavior.
- Keep operation lock keys and lock scope unchanged for mod install/uninstall.
- Prefer a route registration shape that passes an explicit context object rather than importing mutable server globals from route files.
- Avoid a generic `utils.mjs`; create modules around concrete responsibilities: response/static, route families, server lifecycle, and feed watching.

## Must Not Change

- Do not move install/update/uninstall execution logic during mechanical desktop extractions.
- Do not change IPC or API channel names unless every caller and test is updated in the same slice.
- Do not collapse desktop and viewer boundaries; the Electron shell continues to reuse the viewer server.
- Do not rename the product or convert browser UI to React/Vue.
- Do not create broad junk-drawer utility modules.
- Do not mix behavior changes with extraction-only patches.
