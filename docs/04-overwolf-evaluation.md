# Overwolf Evaluation

Overwolf may be useful as a renderer or overlay host, but it should not be the core sidecar engine.

## Why It May Be Useful

- It can provide an overlay-style presentation surface.
- It may offer distribution and game-adjacent UI affordances users already understand.
- It could render hook health, battle summaries, session timeline, and diagnostics while the sidecar core does the parsing and storage.

## How It Could Consume Sidecar Data

Overwolf should consume a local sidecar event API, not read from or control the game process directly. Possible consumption paths:

- Read a local JSONL event stream written by the mod and tailed by sidecar core.
- Subscribe to a later localhost WebSocket event stream exposed by sidecar core.
- Request battle/session summaries from a later localhost HTTP API.

## Why Core Should Remain Platform-Neutral

- The sidecar parser, event model, session store, and diagnostic bundle logic should work without Overwolf installed.
- Desktop UI, Overwolf UI, CLI tooling, and Majel integration should all consume the same core events.
- Keeping Overwolf optional avoids platform lock-in and lets v0 ship useful diagnostics before overlay decisions are settled.

## What To Test Early

- Whether STFC is supported by Overwolf overlay APIs in practice.
- Whether overlay windows render reliably with STFC's graphics mode.
- How review/distribution policies treat diagnostic overlays for this game.
- Whether localhost communication from an Overwolf app to sidecar core is allowed and stable.
- Whether overlay focus behavior risks accidental input capture.

## Risks

- Platform lock-in.
- Review and distribution friction.
- Game support uncertainty.
- Overlay limitations or rendering instability.
- Extra operational complexity compared with a normal desktop UI.

## Explicit Ban

Do not use Overwolf input, hotkey, macro, keystroke, mouse, or gameplay automation APIs to control STFC. An Overwolf UI may display diagnostics and accept user interaction inside the sidecar UI, but it must not automate gameplay.
