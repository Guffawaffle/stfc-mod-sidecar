# Integration Plan For Community Mod

The smallest useful mod-side change is one-way structured event export.

There are now two valid runtime shapes:

```text
basic install:
community mod -> canonical JSONL feed -> sidecar viewer / offline tools

full install:
community mod -> localhost HTTP export -> sidecar ingest -> SQL store
```

The sidecar should not reach into the game process. The mod should not depend on the sidecar being present.

The first sidecar prototype used JSONL as the easiest inspection boundary. That path is still worth keeping for low-friction installs and offline debugging. The broader runtime direction is stricter:

- the mod exports canonical sidecar events
- JSONL remains available as a basic local export path
- the sidecar owns durable SQL storage when HTTP ingest is enabled
- storage lives behind a SQL adapter so SQLite and PostgreSQL can share one ingest contract

## V0 Event Export

The mod should be able to emit canonical sidecar events in two ways:

- JSONL file for dependency-free installs and easy inspection
- localhost HTTP for sidecar-owned SQL persistence

Both transports should stay local-only and narrow. Localhost HTTP works well for the advanced path because the mod already has an HTTP sync transport and the sidecar can authenticate the ingest route with a shared token header.

The existing sync-target model should carry the realtime feed from the beginning. A target-scoped `battlelogs_realtime` option keeps this aligned with other export categories, whether the destination is the local sidecar ingester, `spocks.club`, `stfc.phd`, or another consumer of the canonical battle feed.

Each event should include:

- `protocolVersion`
- `modVersion`
- `sessionId`
- `type`
- `timestamp`
- event-specific payload fields

The exporter should be best-effort. Failure to deliver sidecar diagnostics must not break gameplay or core mod behavior.

## Initial Event Types

- `debug.event`: structured diagnostics and debug breadcrumbs.
- `hook.event`: hook install status and fallback/error state.
- `battle.event`: parsed or observed battle lines/events.
- `session.event`: mod start/stop and connection lifecycle.
- `integration.event`: optional user-initiated integration status later.

## Mod Responsibilities

- Observe game/mod state.
- Emit structured events.
- Include enough version/session metadata to correlate logs.
- Avoid UI ownership and external integration policy.
- Never expose gameplay control commands.

## Sidecar Responsibilities

- Accept canonical event export from the mod.
- Continue reading canonical JSONL feeds for the basic path.
- Validate and normalize events.
- Persist events through a canonical SQL adapter.
- Parse battle-log text when raw battle logs are available.
- Store local session timeline.
- Export reviewable diagnostic bundles.
- Handle optional integrations only after explicit user action.

## Later Bridge Options

Ranked by v0 suitability:

1. JSONL file: simplest, zero-service, lowest-friction install path.
2. Localhost HTTP: preferred when the sidecar should own durable SQL storage.
3. Windows named pipe: local and narrow, but Windows-specific and more lifecycle-sensitive.
4. Localhost WebSocket: best for live UI later, but more moving parts than v0 needs.

V0 should support both:

- JSONL for basic installs
- local HTTP plus SQL storage for richer sidecar workflows

Local proof-of-concept convention:

- sidecar ingest URL: `http://127.0.0.1:43127/api/events`
- local token: `testtoken123`
- target toggle: `battlelogs_realtime = true`
