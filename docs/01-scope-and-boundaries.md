# Scope And Boundaries

The sidecar exists for diagnostics and read-only integration. It must not become an automation tool.

## Allowed

- Read-only diagnostics.
- Structured debug logs.
- Battle-log parsing.
- Hook health display.
- Local session timeline.
- Exportable diagnostic bundles.
- Majel/reference lookups.
- Optional future overlay display.
- User-initiated actions such as "send this battle/session to Majel".

## Forbidden

- Auto-clicking.
- Sending keystrokes to STFC.
- Combat automation.
- Navigation automation.
- Auto-claiming.
- Account manipulation.
- Hidden advantage logic.
- Anything that controls gameplay for the player.

## Design Boundary

The sidecar may read files, parse text, display diagnostics, and send user-approved exports to external services. It must not reach into the game process, patch memory, synthesize input, or expose a command channel that changes gameplay state.
