# Production Mod Boundary

Decision date: 2026-05-01

## Decision

The C++ community mod remains the production mod until a managed BepInEx port proves replacement parity in writing.

The sidecar must remain mod-agnostic. It communicates through local files and documented local API contracts, not implementation internals from any one mod runtime.

The BepInEx/scmod port is parked as a research reference. Do not resume it unless the current C++ mod plus sidecar architecture reaches a hard blocker that cannot be solved cleanly inside the current model.

## Why

The project has had too many competing centers of truth: upstream C++ mod, fork C++ mod, sidecar, AX, and a managed BepInEx rewrite. That splits attention and makes every useful feature feel like an architecture referendum.

The current C++ mod already has the most important production properties:

- it is installed and validated against the live Windows game
- it has an existing macOS path in the upstream project
- it already emits files the sidecar can consume
- it is the path upstream maintainers and users understand today

The sidecar should grow around stable contracts instead of coupling to C++ symbols, managed plugin classes, or a future loader choice.

## What This Means

### C++ Mod

The C++ mod is the production runtime.

Near-term mod work belongs here when it affects:

- live gameplay-adjacent behavior
- battle feed emission
- config compatibility
- upstreamable fixes
- Windows or macOS packaging
- runtime diagnostics that must ship with the current mod

### Sidecar

The sidecar is a separate product and should stay runtime-neutral.

It may depend on:

- JSONL event files
- documented local file contracts
- documented localhost APIs
- diagnostic bundle schemas
- sample/replay fixtures

It must not depend on:

- C++ implementation details
- BepInEx implementation details
- direct game process injection
- synthesized game input
- hidden gameplay command paths

### BepInEx Port

The BepInEx port remains useful as reference material and a future replacement candidate, but it is not the main road.

It can be revisited only if at least one of these is true:

- the C++ mod cannot support a required safe sidecar contract without unacceptable complexity
- the C++ hook layer becomes too fragile to maintain after a game/runtime update
- the managed port demonstrates enough parity that replacement is cheaper than continued C++ maintenance

When revisited, the port must pass a written replacement gate before it can become production.

## Replacement Gate For BepInEx

A managed port is not a replacement until it proves all of this:

- Windows daily-driver stability
- config import and runtime vars parity
- hotkey and right-click behavior parity
- battle feed parity consumed by the existing sidecar without sidecar rewrites
- acceptable live frame-time overhead
- safe dynamic settings/control channel story
- clear macOS answer
- rollback instructions back to the C++ mod
- documented known gaps accepted by the maintainer

Until then, it is a research branch.

## Development Environment

Primary development and verification should stay on Windows.

Reasons:

- STFC runs there for the primary maintainer workflow
- deployment, logs, DLLs, game folders, and AX verification are Windows-adjacent
- file watchers and local paths are easier to reason about without a WSL boundary

WSL2 remains useful for read-only analysis, prototype builds, and isolated experiments, but it should not become the daily source of truth for game/runtime verification.

## Platform Stance

### Windows

Primary supported runtime and validation target.

### macOS

Preserve the current upstream C++ macOS path unless a replacement proves itself. Do not make a BepInEx migration that silently drops macOS users.

### Linux

The sidecar should run on Linux where practical. The game has no native Linux client, so mod runtime support under Wine or similar setups is best-effort unless a stable user path emerges.

## Dynamic Settings And Control

Dynamic behavior should be designed around contracts, not implementation details.

Safe first targets:

- diagnostics toggles
- log verbosity
- feed emission toggles
- frame-time threshold settings
- local viewer/debug behavior

Risky or disallowed targets:

- attacking
- navigation
- target selection
- claiming
- queue actions
- any sidecar action that synthesizes game input or performs gameplay for the user

Some settings should remain next-launch-only. Live apply should be explicit and acknowledged by the mod.

Preferred control shape, if/when added:

- append-only local request file or authenticated local API route
- explicit command allowlist
- bounded payload sizes
- monotonic request IDs
- rate limits
- append-only audit response stream
- default off
- no reflection-based command execution

## Live Testing Boundary

Allowed test layers:

- replay tests with sample files and no game process
- passive live smoke tests that observe logs/feed files only
- manual-assisted live tests where a human performs game actions and the tool observes expected events
- browser/sidecar automation outside the game process

Disallowed test layers:

- automated combat input
- automated navigation input
- auto-claiming
- target selection automation
- hidden gameplay command execution

The live test harness should help a human verify behavior. It should not play the game.

## Near-Term Work Plan

1. Stabilize the C++ battle feed and sidecar viewer as the production diagnostics path.
2. Define the sidecar event/file contracts that the C++ mod must satisfy.
3. Add replay tests and sample fixtures for those contracts.
4. Add passive/manual live smoke tooling that watches logs and JSONL feeds.
5. Add safe dynamic diagnostics/settings only after the contract and audit path are written down.
6. Keep upstream C++ PRs focused and small.
7. Keep the BepInEx port parked unless a hard blocker is recorded.

## Hard Blocker Definition

A hard blocker is a production goal that is safe and in scope, but cannot be implemented in the C++ mod plus sidecar architecture without disproportionate fragility, maintenance cost, or platform loss.

Preference, polish, or managed-code convenience is not a hard blocker.
