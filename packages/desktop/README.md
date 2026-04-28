# @stfc-mod-sidecar/desktop

Electron shell for the STFC Sidecar UI.

## Role

Open a `BrowserWindow` pointed at the local sidecar HTTP server and host the
React UI from `@stfc-mod-sidecar/ui`. The renderer is sandboxed and uses
**zero** Electron IPC — the same UI bundle runs identically in Overwolf or a
plain browser tab. All communication is HTTP (SSE + REST) to the local
sidecar server.

See [`docs/14-electron-overlay-architecture.md`](../../docs/14-electron-overlay-architecture.md).

## Dev

```
# Terminal A — sidecar HTTP server
npm --workspace @stfc-mod-sidecar/server start

# Terminal B — UI dev server (Vite)
npm --workspace @stfc-mod-sidecar/ui dev

# Terminal C — Electron shell (loads Vite at :43128)
npm --workspace @stfc-mod-sidecar/desktop dev
```

In production mode the shell loads the static UI bundle served by the sidecar
server at `http://127.0.0.1:43127`.

The UI must not send gameplay input to STFC or expose gameplay automation
commands. Settings control is for the Community Mod's own configuration only.
