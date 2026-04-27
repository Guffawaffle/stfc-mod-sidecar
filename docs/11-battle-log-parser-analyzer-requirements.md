# Battle-Log Parser And Analyzer Requirements

## Goal

The sidecar viewer should grow from a feed explorer into a battle-log workbench.

That workbench needs two separate responsibilities:

1. Parse canonical `battle.capture` data into deterministic intermediate structure.
2. Analyze that structure into reviewable round, attack, and ship-level diagnostics.

The viewer should expose both layers clearly enough that we can inspect raw evidence, derived structure, and higher-order interpretation without blurring them together.

## Scope Boundary

Primary input:

- `battle.capture` with `schemaVersion = stfc.battle.capture.v1`

Secondary comparison input:

- `battle.report` as the compatibility bundle already emitted by the mod

Optional later inputs:

- saved sample capture files
- future `battle.decode` events
- future `battle.analytics` events

Out of scope for this workbench:

- sending commands to the game
- mutating mod state
- inventing gameplay semantics with no token-level evidence

## Functional Requirements

### 1. Capture Selection

The workbench must let the user:

- choose a specific battle event from the feed
- pin a selected journal while new feed lines arrive
- switch between live feed input and saved sample captures later

### 2. Raw Evidence View

The workbench must preserve direct access to:

- top-level event envelope
- `capture.summary`
- `capture.participants`
- full raw `battleLog.tokens`
- raw journal data outside `battle_log`

No derived field should exist without a way to inspect the source tokens or source objects it came from.

### 3. Deterministic Parser Stages

The parser stage should produce stable, testable intermediate outputs such as:

- token classification
- segment boundaries
- record boundaries
- marker inventory
- entity references
- ship and component references
- round and sub-round grouping candidates
- attack-row extraction candidates
- triggered-effect extraction candidates

Each stage should be deterministic and versionable.

### 4. Provenance And Confidence

Every derived structure should carry enough metadata to explain why it exists.

Minimum provenance fields:

- parser stage name
- parser rule version
- source token indexes or source record indexes
- confidence level or certainty class
- warning notes when assumptions are still provisional

### 5. Analyzer Outputs

The analyzer stage should be able to derive and present:

- round timeline
- sub-round timeline
- attack rows
- attacker and target ship pairings
- hull, shield, mitigated, and auxiliary scalar totals
- triggered effect summaries
- per-ship participation summaries
- anomaly flags for malformed or partially understood captures

### 6. Parity And Comparison

The viewer should make it easy to compare:

- raw `battle.capture`
- deterministic parser output
- `battle.report` compatibility fields

Comparison views should highlight where the report already matches parsed structure and where parser or analyzer work still needs confirmation.

### 7. Diagnostics UX

The workbench page should support:

- stage-by-stage tabs or panels
- tables for tokens, records, rounds, attacks, and participants
- empty-state messaging when a stage has no output yet
- warning surfaces for unknown markers or partial parses
- raw JSON inspection alongside structured tables

## Non-Functional Requirements

### Deterministic

Given the same capture payload, the parser and analyzer must produce the same outputs every time.

### Reversible

A user should be able to walk from an analyzer result back to the source tokens that justified it.

### Secret-Free

The workbench must stay within the existing sidecar rule that event data and derived battle data remain secret-free.

### Testable

Parser and analyzer rules should be backed by sample fixtures and golden tests, not only manual viewer inspection.

### Incremental

New semantics should land as additive stages or additive fields. Unknown markers must remain visible instead of being guessed away.

### Responsive

The viewer should stay usable on a single capture without obvious lag. Heavy tables should support truncation, paging, or staged rendering before we add larger batch analysis.

## Multipage Viewer Requirements

The current viewer should be treated as a module shell, not a single page.

Required page layout:

- `/`: viewer home
- `/battle-log/`: current battle-log explorer
- `/battle-log/workbench/`: planned parser and analyzer workbench

Page architecture requirements:

- each page gets its own HTML entrypoint
- page-specific JavaScript should live with that page instead of in a root-global `app.js`
- shared styling and navigation may stay common until a larger shell is needed
- the server should serve nested static assets without per-route hard-coding

## Delivery Sequence

### Phase 1. Parser Diagnostics Page

- token index and marker inventory
- segment and record boundary views
- parser provenance metadata

### Phase 2. Analyzer Tables

- rounds and sub-rounds
- attack rows
- per-ship summaries

### Phase 3. Comparison Mode

- side-by-side `battle.capture` versus `battle.report`
- mismatch and parity surfaces

### Phase 4. Fixture And Regression Harness

- saved capture corpus
- viewer-friendly sample selection
- golden tests for parser/analyzer stages

## Immediate Next Implementation Targets

The next code slice should focus on:

1. a parser-stage model that can expose tokens, segments, and records without claiming final gameplay semantics
2. a first analyzer panel for rounds and attack rows with provenance links back to source tokens
3. comparison surfaces between `battle.capture`, parser stages, and `battle.report`