# 14 — Electron Overlay Architecture

Status: Approved 2026-04-28. Foundation for the LCARS sensor panel, Majel
integration, on-screen mod settings, and eventual Overwolf overlay.

## Goal

A single UI codebase that runs identically as:

- An Electron-packaged desktop window (tray + always-on-top + side monitor)
- An Overwolf in-game overlay (later)
- A plain browser tab pointed at `http://127.0.0.1:43127`

The UI is event-driven, never polls, and acts as a control surface for the
STFC Community Mod and adjacent local services (Majel, AXF cycle, settings).

## Core Constraint

Overwolf apps run in Overwolf's Chromium and cannot use Electron IPC or
Node APIs. Therefore the contract between UI and server is **pure HTTP**:
SSE for push, REST for control. No shell-specific transport ever ships in
the UI.

```
┌─ Shell (Electron / Overwolf / browser tab) ───────────────────┐
│  BrowserWindow → http://127.0.0.1:43127                       │
└───────────────────────────────────────────────────────────────┘
        │ EventSource                    │ fetch
        ▼                                ▼
┌─ packages/server ─────────────────────────────────────────────┐
│  GET  /api/events/stream    SSE — server push                 │
│  GET  /api/events           REST snapshot                     │
│  POST /api/events           mod ingest (existing)             │
│  GET  /api/settings         read live TOML                    │
│  POST /api/settings/patch   write TOML, signal mod hot-reload │
│  POST /api/mod/cycle        trigger AXF cycle                 │
│  GET  /api/majel/*          Majel bridge                      │
│  POST /api/majel/command    send command to Majel             │
└───────────────────────────────────────────────────────────────┘
        │ node:sqlite / pg            │ child_process / fetch
        ▼                             ▼
   sidecar-events.sqlite          Majel HTTP API
   community_patch_settings.toml
```

## Package Layout

```
packages/
  core/      ← types, parsers, SQL store (existing, unchanged)
  server/    ← TS migration of viewer/server.mjs; owns all HTTP
  ui/        ← Vite + React + TS + Tailwind; sensor panels, LCARS
  desktop/   ← Electron 30 shell; BrowserWindow + tray + always-on-top
  viewer/    ← legacy static viewer; deprecated, kept until ui ships
```

## Stack

| Layer            | Choice                                              |
|------------------|-----------------------------------------------------|
| Server runtime   | Node 20+, native `node:http`, TypeScript            |
| Server transport | SSE for push, REST for control                      |
| Storage          | SQLite (`node:sqlite`) default; PostgreSQL optional |
| UI framework     | React 18 + TypeScript                               |
| UI build         | Vite 5                                              |
| UI styling       | Tailwind CSS + custom CSS modules for LCARS         |
| UI a11y          | Radix UI primitives (skinned)                       |
| UI client state  | Zustand                                             |
| UI server state  | Native `EventSource` + `fetch`; TanStack Query opt. |
| Shell            | Electron 30 + electron-forge                        |
| Monorepo         | npm workspaces                                      |

## Non-Goals

- No Electron IPC in the UI — it must keep working in Overwolf and a browser.
- No bundler in the server — TypeScript compiles directly to ES modules.
- No component library skin (shadcn/Radix-themed) for LCARS surfaces. Radix
  is used as accessibility primitives only; LCARS visuals are hand-built.
- No automation surface that could send gameplay input to STFC. Settings
  control is for the Community Mod's own configuration only.

## Migration Plan

1. **Groundwork (this commit)**: scaffold `packages/server`, `packages/ui`,
   repurpose `packages/desktop` as Electron shell. Empty but buildable.
2. **Server migration**: extract `viewer/server.mjs` into `packages/server`
   as TypeScript. Add SSE endpoint as part of this work.
3. **UI bootstrap**: minimal React app that subscribes to SSE and renders
   the live event list. Replaces `viewer/public/`.
4. **Electron shell**: `packages/desktop` opens a `BrowserWindow` to the
   server, adds tray + always-on-top.
5. **Settings control**: `/api/settings` read/patch endpoints; first
   on-screen mod settings panel.
6. **Majel bridge**: `/api/majel/*` proxy + first integration UI.
7. **LCARS pass**: visual design across all panels.
8. **Overwolf**: package the same UI as an Overwolf app.

## Lifecycle of a Battle Event (target state)

```
mod (C++)
  └─ POST /api/events  ──►  server
                              ├─ store in SQLite
                              └─ broadcast on SSE  ──►  every connected UI
```

No file watching, no polling. JSONL feed remains as the basic-mode
fallback when the SQL store is disabled.
