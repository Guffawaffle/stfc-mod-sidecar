# Integration Plan For Community Mod

The smallest useful mod-side change is one-way structured event emission:

```text
community mod -> JSONL file -> sidecar
```

The sidecar should not reach into the game process. The mod should not depend on the sidecar being present.

## V0 Event File

The mod writes newline-delimited JSON events to a known local path, such as a file beside the existing community patch logs.

Each event should include:

- `protocolVersion`
- `modVersion`
- `sessionId`
- `type`
- `timestamp`
- event-specific payload fields

The writer should be best-effort. Failure to write sidecar diagnostics must not break gameplay or core mod behavior.

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

- Tail or ingest the JSONL file.
- Validate and normalize events.
- Parse battle-log text when raw battle logs are available.
- Store local session timeline.
- Export reviewable diagnostic bundles.
- Handle optional integrations only after explicit user action.

## Later Bridge Options

Ranked by v0 suitability:

1. JSONL file: simplest, robust, lowest coupling, easiest to inspect.
2. Windows named pipe: local and narrow, but Windows-specific and more lifecycle-sensitive.
3. Localhost HTTP: easy to inspect and integrate, but introduces port management and local API surface concerns.
4. Localhost WebSocket: best for live UI later, but more moving parts than v0 needs.

V0 should start with JSONL.
