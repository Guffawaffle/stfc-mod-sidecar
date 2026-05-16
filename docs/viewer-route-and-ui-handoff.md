# Viewer Route And UI Handoff

This handoff tracks the remaining UI modularization work after the desktop main split and viewer server route slices.

## Current State

- Desktop entrypoint extraction is done:
  - `packages/desktop/src/main-window.mjs`
  - `packages/desktop/src/sidecar-server-process.mjs`
  - `packages/desktop/src/desktop-ipc.mjs`
- Viewer server route extraction is done for the route and feed-watcher slices:
  - `packages/viewer/server/static-files.mjs`
  - `packages/viewer/server/routes/health-routes.mjs`
  - `packages/viewer/server/routes/settings-routes.mjs`
  - `packages/viewer/server/routes/mod-install-routes.mjs`
  - `packages/viewer/server/routes/mod-uninstall-routes.mjs`
  - `packages/viewer/server/routes/diagnostics-routes.mjs`
  - `packages/viewer/server/routes/event-routes.mjs`
  - `packages/viewer/server/feed-watcher.mjs`
- `packages/viewer/server.mjs` still owns main HTTP dispatch, release/dev/status routes, shutdown lifecycle, stream clients, settings update helpers, and event-store fallback behavior.
- Manual smoke still recommended before release: `npm run desktop:dev`.

## Completed Server Slices

1. Mod install routes:
   - `/api/mod/release-catalog`
   - `/api/mod/install-plan`
   - `/api/mod/verify-artifact`
   - `/api/mod/install-preflight`
   - `/api/mod/stage-artifact`
   - `/api/mod/install-confirmation`
   - `/api/mod/install-execution`

2. Mod uninstall routes:
   - `/api/mod/uninstall-plan`
   - `/api/mod/uninstall-confirmation`
   - `/api/mod/uninstall-execution`

3. Diagnostics bundle route:
   - `/api/diagnostics/bundle`

4. Event and fleet routes:
   - `/api/events`
   - `/api/events/stream`
   - `/api/events/:lineNumber`
   - `/api/fleet/sync`

5. Feed watcher extraction:
   - watcher setup
   - debounce and close behavior
   - feed index and detail-cache state

## Remaining Order

1. Split `packages/viewer/public/about/app.js`:
   Good first split: Community Mod install/update/uninstall state and actions.

2. Split `packages/viewer/public/settings/app.js`:
   Good first split: keyboard capture/binding helpers, then notifications and diagnostics panels.
   Split `packages/viewer/public/about/app.js`.
   Split `packages/viewer/public/settings/app.js`.

## Safety Constraints

- Do not move Community Mod install/uninstall execution internals out of existing `community-mod-*` modules during route extraction.
- Do not change API paths, HTTP methods, response status codes, auth headers, consent headers, or JSON field names.
- Keep GitHub network consent checks and mod bearer-token checks before mod route handlers.
- Keep operation lock keys and lock scope unchanged for install/uninstall.
- Keep STFC running checks, explicit acknowledgement fields, hash confirmation, and destination-path confirmation unchanged.
- Keep Developer Tools and capability gating before route-specific behavior.
- Route modules should receive explicit context objects instead of importing mutable server globals.
- Avoid generic utility modules. Use concrete modules around route families and feed watching.

## Validation Per Slice

Run after each slice:

```bash
node --check packages/viewer/server.mjs
node --check <new-or-touched-viewer-module>
npm test --workspace @stfc-mod-sidecar/desktop
npm run ax -- check
git diff --check
```

Add focused route tests under `packages/desktop/test/` matching the existing pattern:
- `viewer-health-routes.test.mjs`
- `viewer-settings-routes.test.mjs`
- `viewer-static-files.test.mjs`
- `viewer-mod-install-routes.test.mjs`
- `viewer-mod-uninstall-routes.test.mjs`
- `viewer-diagnostics-routes.test.mjs`
- `viewer-event-routes.test.mjs`
- `viewer-feed-watcher.test.mjs`

## UI Split Notes

For `about/app.js`:
- Good first split: Community Mod install/update/uninstall state and actions.
- Keep GitHub consent prompt behavior unchanged.
- Keep desktop-only mod operation gating unchanged.
- Keep confirmation dialog acknowledgement flow unchanged.

For `settings/app.js`:
- Good first split: keyboard capture/binding helpers.
- Then split notifications and diagnostics panels.
- Keep save-token behavior, dirty-state tracking, and Developer Tools diagnostics gating unchanged.
