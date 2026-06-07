# Observed Hostile Observation Boundary Report

Date: 2026-06-06

Checkpoint commit: `50cedbd` (`Add observed hostile reference and observation views`)

## Scope

This report covers the current `Observed Hostile Catalog` behavior after the observations-first UI/ref-data work, with specific focus on how `System Observations` are bounded and why the current implementation still uses a time window.

The core question is whether observation windows should be started and ended by real view/session state, rather than by a rolling gap timer.

## Current Behavior

### Passive hostile capture

Passive hostile capture is currently driven by `FleetDataSystem` hooks in the game mod:

- `FleetDataSystem.OnFleetsAddedEvent`
- `FleetDataSystem.OnFleetsUpdatedEvent`
- `FleetDataSystem.OnFleetsEnterSystemEvent`
- `FleetDataSystem.AddFleet`
- `FleetDataSystem.UpdateFleet`

Source:

- `D:\dev\stfc-mod\mods\src\patches\hostile_observation_fleet_data_hooks.cc`

Relevant implementation points:

- hostile filtering and payload construction: lines 191-235
- sidecar emission: lines 238-257
- hooked callbacks: lines 281-325

The emitted passive event is an `observed.hostile` row with `sourceSurface = fleet_data_system`.

Important: this is **not** a per-frame scan of all visible hostiles. It is a stream of hostile sightings emitted only when the game's fleet-data layer calls one of those methods.

### Retired UI probes

Frame-probed UI/interaction hostile observation has already been retired.

Source:

- `D:\dev\stfc-mod\mods\src\patches\hostile_observation_probe.cc`

Relevant implementation points:

- `hostile_observation_frame_subscriber_enabled()` returns `false`: line 21
- `hostile_observation_tick()` is a no-op: lines 24-27
- retirement reason explicitly says FleetDataSystem is now canonical: lines 16-18, 29-43

So there is currently no active frame-based hostile polling pass.

### Viewer-side observation projection

The viewer currently reconstructs `System Observations` from stored passive sightings.

Source:

- `D:\dev\stfc-mod-sidecar\packages\viewer\server\observed-hostile-access.mjs`

Relevant implementation points:

- default observation gap window: line 7
- build observations from sightings: lines 314-330
- append sightings into a window: lines 450-479
- start a new window when gap exceeds threshold or system changes: lines 481-484

Current rule:

1. Sort passive sightings by timestamp.
2. Keep them in one observation while:
   - the system id stays the same, and
   - the time gap stays under the configured window.
3. Split when:
   - system id changes, or
   - gap exceeds the window.

## Why the 5-Minute Window Was Introduced

The 5-minute default should not be interpreted as "it takes 5 minutes to discover ships."

What it really means:

- the game renders ships immediately,
- the mod emits passive sightings only when `FleetDataSystem` fires,
- those callbacks are sparse and bursty,
- the viewer needs some way to stitch those sparse delta events back into one human-facing "I was in this system" observation.

The window is a reconstruction heuristic, not capture latency.

## Live Evidence

### System under test

- user-reported system: `tln jlb`
- observed system id: `189591311`

### What the live store showed

For `189591311`, the live catalog already contained all four expected hostile buckets:

- `Hull_L51_Explorer_Klg_G5`
- `Hull_L50_Explorer_Klg_G5`
- `Hull_L51_Survey_Klg_G5`
- `Hull_L50_Survey_Klg_G5`

The issue was not missing capture. The issue was fragmented observation windows.

### Raw passive event cadence

Recent `fleet_data_system` passive events for `189591311` arrived with gaps like:

- `119s`
- `123s`
- `120s`
- `245s`
- `121s`
- `111s`
- `121s`

That means a `60s` grouping rule was too short for this passive source. One continuous stay in-system was being split into a series of tiny observation cards, some of which happened to contain only survey ships or only explorer ships.

After widening the default grouping window, the live viewer returned a single richer observation:

- system id: `189591311`
- observation window: `2026-06-06T22:42:47Z` to `2026-06-06T23:07:05Z`
- passive raw events: `51`
- observed hostiles: `4`
- entries:
  - `Hull_L50_Survey_Klg_G5`
  - `Hull_L51_Explorer_Klg_G5`
  - `Hull_L51_Survey_Klg_G5`
  - `Hull_L50_Explorer_Klg_G5`

This confirms the underlying passive capture is working for this system. The weakness is observation boundary reconstruction.

## Assessment: Section-Based Observation Sessions

### Short answer

Yes. Starting an observation on system-view entry and ending it on leaving system view is a better model than an arbitrary timer.

### Why this is plausible in the current runtime

The mod already has access to current section state through `Hub::get_SectionManager()->CurrentSection`.

Source:

- `D:\dev\stfc-mod\mods\src\prime\Hub.h`

Relevant implementation points:

- `Hub::get_SectionManager()`: lines 295-300
- current section convenience helpers: lines 308-320
- known section ids include:
  - `Navigation_Galaxy`
  - `Navigation_System`
  - `Starbase_Interior`
  - `Starbase_Exterior`

The mod also already has a per-frame hook point at `ScreenManager.Update`.

Source:

- `D:\dev\stfc-mod\mods\src\patches\frame_tick.cc`

Relevant implementation points:

- frame hook install and callback fan-out: lines 27-43, 112-158

So the basic ingredients already exist:

1. a per-frame place to observe state transitions
2. an authoritative current section signal
3. a sidecar/local ingest path that already emits observation events

## What Is Still Missing

We do **not** currently emit a canonical sidecar event that says:

- "entered system view"
- "left system view"
- "current section changed from X to Y"

We also have not yet audited exactly how the game's `CurrentSection` behaves for all relevant workflows, especially:

- opening galaxy map
- opening ship management
- inventory
- missions
- station interior/exterior
- transient overlays that may still leave the player effectively "in system"

There is existing live-debug UI change machinery that can help with this audit:

- `mods/src/patches/live_debug_ui_change_events.cc`

That path already records top-canvas and navigation-interaction lifecycle changes, so it is a reasonable place to validate boundary assumptions before making them canonical.

## Recommendation

Replace timer-first observation windows with **session-first observation boundaries**.

### Preferred model

Start a passive observation session when:

- current section enters `Navigation_System`

End the session when:

- current section leaves `Navigation_System`

Then attach passive `fleet_data_system` hostile sightings to the active system-view session instead of grouping them later by gap size.

### Why this is better

It matches the user mental model:

- "when I was looking at this system"

It is also more honest than pretending a time gap implies user departure or a fresh observation.

### What the timer should become

The timer should become a fallback safety mechanism only, for cases like:

- missing exit transition
- crash/restart during a session
- incomplete runtime state

It should not be the primary boundary.

## Proposed Next Smallest Implementation Step

### In the mod (`stfc-mod`)

Add a small system-view session tracker on the existing `ScreenManager.Update` path:

1. Read `Hub::get_SectionManager()->CurrentSection` each frame.
2. Track transitions into and out of `SectionID::Navigation_System`.
3. Emit a compact sidecar/session event on transitions, for example:
   - `session.event`
   - or a dedicated hostile/session event if preferred
4. Include:
   - previous section
   - current section
   - timestamp
   - known current system id if available

### In the viewer (`stfc-mod-sidecar`)

Change `System Observation` projection to:

1. Prefer explicit session boundaries if present.
2. Fall back to gap-based grouping only when no session events exist.

## Risks and Open Questions

1. `CurrentSection` may be too coarse for some overlays.
   - Example: a modal or sub-panel might still count as "same system view" from the user's perspective.

2. Some screens may not carry a system id at transition time.
   - We may need to retain the last observed system id or resolve it from runtime state.

3. The game may bounce through intermediate sections during transitions.
   - We should audit a few real navigation sequences before locking the event schema.

4. "Manage" may or may not count as leaving the observation from a product perspective.
   - Technically it likely changes section.
   - Product-wise we should decide whether that should close the passive observation session or merely pause it.

## Recommended Decision for Admiral Lex

1. Agree that timer-first observation grouping is a temporary reconstruction layer, not the intended final model.
2. Approve a runtime audit of section transitions using current section state and existing live-debug infrastructure.
3. If the audit looks clean, implement section-based system-view sessions as canonical observation boundaries.
4. Keep the current timer logic only as fallback protection, not primary behavior.

## Bottom Line

The current passive hostile capture is working.

The current weakness is not detection speed. It is that we are reconstructing "system observations" from sparse `FleetDataSystem` deltas after the fact.

The better architecture is:

- real system-view session boundaries from runtime section state
- passive hostile deltas attached to those sessions
- timer only as fallback
