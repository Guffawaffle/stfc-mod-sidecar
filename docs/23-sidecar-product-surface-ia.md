# Sidecar Product Surface IA And UI Module Boundaries

This document turns the current sidecar product-surface audit into a concrete information architecture and separation-of-concerns plan.

It is a design document only. It does not change routes, labels, runtime behavior, page visibility, API contracts, mod hooks, or Majel behavior.

## Current Problem

The current sidecar mostly has the right backend boundaries, but the UI surface taxonomy is muddy.

- The sidecar is the local companion product, but the current top-level pages mix setup, diagnostics, and product flows.
- The current `Majel` page is a local ingest/debug monitor, not a user-facing assistant surface.
- `About` currently carries setup, install, support, and diagnostics responsibilities that are larger than an about page.
- `Settings` currently mixes bootstrap, mod configuration, notifications, and developer diagnostics.
- Battle Log already has real user value, so it should not be buried too deeply behind a purely diagnostic frame.
- Large browser entry files already exist in the viewer. Future work must not repeat the pattern of putting routing, fetches, state derivation, DOM rendering, formatting, and feature logic into one large page file.

The design goal is to clarify where product value lives without creating a new giant `app.js` concern dump.

## Target IA

The sidecar should converge on four user-facing surfaces:

1. `Watch`
   - observed fleet state
   - fleet watches and arrival reminders
   - recent activity
   - simple battle and event summaries

2. `Aria`
   - remote assistant connection state
   - explicit local context preview and send
   - member and API status

3. `Setup`
   - install, update, uninstall, and configuration
   - notification preferences
   - support, about, and legal

4. `Diagnostics`
   - raw battle log explorer
   - battle log workbench
   - cloud sync and envelope monitor
   - telemetry and projection internals
   - diagnostics bundle

### IA Intent

- `Watch` is the main local companion value surface.
- `Aria` is the sidecar client bridge to remote intelligence, not a second local intelligence stack.
- `Setup` holds all local ownership and configuration flows that are required to make the companion usable and trustworthy.
- `Diagnostics` remains powerful, but it is explicitly advanced and evidence-oriented.

## Naming Rules

Use names according to ownership, not implementation history.

### `Aria`

Use `Aria` for user-facing assistant surfaces.

- assistant tab name in the sidecar
- remote assistant connection state
- send selected local context to the remote assistant
- assistant-facing help and copy

### `Majel`

Use `Majel` for service, backend, or platform naming.

- repository or deployment identity
- backend integration documentation
- environment variables and service endpoints
- internal integration boundaries

Do not label local telemetry/debug/status pages as `Majel` if the page is actually showing transport, sync, or ingest state.

### `Diagnostics`

Use `Diagnostics` for raw, evidence-heavy, or operator-facing surfaces.

- raw event explorer
- workbench
- envelope monitor
- telemetry internals
- debug capture settings
- diagnostics bundle

### Battle Log Naming

- `Recent Activity` or similar belongs under `Watch` when the UI is showing a user-readable summary.
- `Battle Log Explorer` and `Battle Workbench` belong under `Diagnostics` when the UI is showing raw events, decode evidence, or analyst workflows.

## Placement Rules

### Mod

The mod owns only the minimal observed-fact producer role.

- observe game state
- emit bounded local facts or events
- expose minimal configuration needed for safe producer behavior

The mod does not own:

- sidecar UI
- watch rules or reminder UX
- cloud advisor semantics
- setup UX
- diagnostics workflows

### Sidecar

The sidecar owns the local companion product.

- local projection and read models
- watches and arrival reminder UX
- recent local activity views
- notification delivery preferences
- setup, install, update, and support flows
- local diagnostics and explicit export packaging

The sidecar should consume mod facts and turn them into local product surfaces without pushing product complexity back into the mod.

### Aria Remote / Majel

Remote Aria and Majel own:

- advisor and chat behavior
- membership and authenticated user state
- API-backed tools
- long-lived cloud intelligence
- remote planning or reference experiences

The sidecar may connect to these services, but it should not rename local diagnostics as if they were the remote assistant.

### Aria Local In Sidecar

`Aria local` means a local client and context bridge, not a local LLM runtime.

It may own:

- assistant connection state
- explicit selection of safe local context
- preview of what will be sent
- user-triggered send to remote Aria
- display of remote response status

It must not imply:

- local inference
- hidden background upload of arbitrary local telemetry
- a second independent assistant architecture inside the sidecar

## Battle Log Split

Battle Log should be split by user intent, not by source file or current route.

### Watch Surface

The `Watch` surface should eventually include a simple user-readable recent activity layer.

Examples:

- recent battles resolved
- fleet movement or arrival reminders
- simple outcome and timing summaries
- compact event cards sourced from the existing local event data

This is product-facing activity rendering. It is not raw evidence browsing.

### Diagnostics Surface

`Diagnostics` should keep the current deep battle surfaces.

- raw event explorer
- evidence-heavy decoded battle workbench
- source-token or parser review tools

### Important Transition Rule

Do not hide Battle Log value before `Watch` has a usable recent-activity replacement.

Until `Watch` has a simple recent-activity layer:

- preserve clear discovery of the current battle/event value
- avoid a navigation change that makes battle review feel removed or downgraded
- treat raw Battle Log as a diagnostic surface in naming and destination, but keep it easy to reach during transition

## Separation-Of-Concerns Rules

Future UI changes must be modular at the page level.

### Thin Page Coordinators

Page entry files should stay thin coordinators.

They may:

- wire modules together
- trigger page bootstrap
- register top-level lifecycle hooks
- bind page-specific modules to the DOM

They should not become the main place for:

- API call implementation
- derived-state logic
- formatting rules
- notification or watch-rule logic
- DOM rendering templates built as giant string blobs
- cross-surface business logic

### Proposed Module Shape For Future `Watch` Work

For a new `Watch` surface, prefer a module layout like this:

- page coordinator
  - route entry, lifecycle startup, dependency wiring
- API client
  - fetches current projection, recent activity, reminder data, or watch actions
- state and derived-state module
  - normalizes payloads, computes visible groups, stale states, unread or pending counts
- render module
  - builds DOM sections or view fragments from already-prepared view models
- event wiring module
  - button listeners, refresh actions, SSE hookup, filter controls
- formatters
  - status labels, timestamps, compact summary strings, safe display labels
- notification and watch-rule logic
  - local reminder rules, quiet-window checks, dedupe, escalation policy

This split is a reviewability rule, not a suggestion.

### Concrete Reviewability Rules

Future UI patches should follow these rules:

- One patch should not simultaneously invent the IA, add feature behavior, and reorganize every page.
- New API calls belong in dedicated client modules, not inline throughout a page entry file.
- Derived state should be testable without a live DOM.
- Formatting helpers should not be mixed into event listeners.
- Watch and notification policy should not be embedded in rendering code.
- Shared behavior should move to concrete modules with clear names, not to a generic utility dump.
- If a page entry file starts accumulating routing, API calls, state transforms, listeners, and HTML assembly together, stop and split before adding more behavior.

## Smallest Implementation Sequence

Evaluate future work in this order:

1. `Nav and copy only IA cleanup`
   - rename surfaces and descriptions to match the target model
   - do not add behavior
   - do not bury current Battle Log access

2. `Move and rename current Majel debug page`
   - keep behavior the same
   - place it under `Diagnostics`
   - rename it to `Cloud Sync Monitor`, `Envelope Monitor`, or equivalent

3. `Preserve Battle Log value during reclassification`
   - keep raw explorer and workbench under `Diagnostics`
   - maintain obvious access while `Watch` has no recent-activity layer yet

4. `Add Watch page structure without new behavior`
   - create the module boundaries and route shell only
   - avoid a single new `Watch/app.js` monolith

5. `Add Fleet Watch and arrival reminders`
   - local sidecar watch rules and reminder UX
   - still no Majel backend changes required for the first slice

6. `Add simple battle and activity summary render`
   - use existing local event data where possible
   - keep raw explorer and workbench as diagnostics surfaces

## Key Decisions

- The sidecar is the local companion product.
- The mod stays a minimal observed-fact producer.
- Remote Aria and Majel own advisor, chat, tools, membership, and API-backed intelligence.
- `Aria local` in the sidecar is a client and context bridge, not a local LLM runtime.
- Battle activity has product value and should not disappear into diagnostics before a `Watch` summary exists.
- Diagnostics surfaces remain important, but they should be named as diagnostics, not as the assistant.
- Future UI changes must prioritize reviewable module boundaries over giant page-entry files.

## Open Questions

- Should the first nav cleanup keep a temporary top-level `Battle Log` affordance until `Watch` has recent activity, or is a strong in-page `Watch` link sufficient?
- Should `Setup` remain one route with multiple panels first, or should install/support split later after the IA rename is stable?
- What is the minimum local context bundle that `Aria` can preview and send without confusing users about privacy or automation boundaries?

## Parking Lot

- Future settings/config work may include a small TOML editor or live TOML preview that shows what pending or applied settings would write. This is provisional and intentionally outside the Battle Report and Fleet Watch activity scope.

## Recommended First Implementation PR

The first implementation PR should be a nav-and-copy-only IA cleanup.

Scope:

- rename surfaces toward `Watch`, `Aria`, `Setup`, and `Diagnostics`
- reclassify the current `Majel` page as a diagnostics monitor without changing its behavior
- preserve obvious access to current Battle Log value
- add no new feature behavior
- avoid creating any new large page-entry files

Out of scope:

- fleet watch rules
- arrival reminders
- recent activity rendering
- Majel backend changes
- mod/native changes
