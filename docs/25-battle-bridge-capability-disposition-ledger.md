# Battle Bridge Capability And Disposition Ledger

Status: planning contract for issues #55 and #75; no runtime IDs below become
accepted merely by appearing in this document.

## Purpose

Battle Bridge extends the native Mod Bridge feature resolver. It does not use
the Sidecar profile matrix as a second eligibility system. This ledger records
what must be preserved, what evidence would make each player feature eligible,
and what happens to every legacy Sidecar surface.

The governing evaluation order is:

```text
positively detected runtime capability
  + checked-in product policy
  + active feature dependencies
  = immutable, reason-bearing eligibility plan
  + player preference where the feature is optional
  + retained-data and runtime-lifecycle state where applicable
  = selected implementation and running player experience
```

Provider identity remains authoritative for source discovery, artifact trust,
installation, migration, and provenance. It is evidence metadata, not a
feature switch. Guffawaffle is the first known producer of Battle data. A
future NetniV or other reviewed build can activate any matching feature by
publishing the same accepted capability evidence.

Inventory snapshot (2026-08-08): Sidecar `02d2264518779b3edadfa42ca07dace580a93222`,
native Bridge `a797254a54a82bfd1fe3f928820fd5290588284c`, and Guffawaffle mod
`b50dc8522a1f289c0ed2e6d86790d0c830be6962`. These revisions identify the
source inventory only. They are not a claim that an artifact built from any
revision advertises the candidate capabilities below.

## Vocabulary And Authority

| Term | Authority | Rule |
| --- | --- | --- |
| Provider-pack capability | `LauncherDistributionProviderCatalog` | Describes provider-level release, trust, configuration, withdrawal, and migration contracts with `supported`, `unsupported`, or `unknown` status. It does not prove a runtime event family. |
| Runtime capability | Positively detected runtime manifest normalized into `LauncherRuntimeProfile` | Describes behavior of the exact installed runtime. Missing, malformed, unsupported, or unrecognized evidence provides no capability. |
| Product feature | `LauncherFeatureCatalog` | Stable player outcome with required runtime capabilities, feature dependencies, default policy, active implementation, and fallback. |
| Product policy | Checked-in `LauncherFeaturePolicy` input | May disable a feature independently of provider and player preference. No remote mutable flag service is introduced. |
| Player preference | Launcher-owned local state | Records whether the player wants an eligible optional feature. It is neither capability evidence nor product policy. |
| Activation decision | Immutable `LauncherActivationPlan` | Records active/inactive state, reason, and selected active or fallback implementation. |
| Current support evidence | Reviewed provider/build/fixture observation | Documents what exists today. It must not be consumed as an owner-name eligibility branch. |

The existing accepted runtime IDs are:

| Kind | Stable ID | Current evidence | Disposition |
| --- | --- | --- | --- |
| Runtime capability | `settings.principal-taxonomy.v1` | Bundled Guffawaffle runtime manifest and schema revision | Shared foundation. |
| Product feature | `settings.semantic-grouping` | `LauncherFeatureCatalog`; requires `settings.principal-taxonomy.v1` | Shared foundation. Battle composition reuses the selected settings layout. |

The existing provider-pack capability IDs (`settings.catalog`,
`runtime.manifest`, `mod.release-discovery`, `mod.artifact-trust`,
`release.withdrawal`, and `config.migration`) remain provider/lifecycle
contracts. They must not be reused as proof that a particular Battle event
family is emitted.

| Provider-pack capability | Disposition |
| --- | --- |
| `settings.catalog` | Shared foundation: selects a positively supported configuration catalog. |
| `runtime.manifest` | Shared foundation: enables positive runtime identity/capability detection; `unknown` remains fail-closed. |
| `mod.release-discovery` | Shared foundation: selects bounded release discovery for the chosen provider/channel. |
| `mod.artifact-trust` | Shared foundation: selects exact reviewed artifact-authentication policy. |
| `release.withdrawal` | Shared foundation: selects provider-owned withdrawal behavior when positively supported. |
| `config.migration` | Shared foundation: supplies migration compatibility evidence; it does not grant permission to rewrite unknown TOML. |

## Proposed Feature And Runtime-Capability Contract

Every ID in this section is a **candidate for principal acceptance**. Issue
#241 must freeze producer declarations and issue #75 must add positive,
versioned fixtures before any candidate enters `LauncherCapabilityIds`, a
runtime manifest, or `LauncherFeatureCatalog`.

Capabilities name the smallest independently useful producer contracts. A
producer may advertise any subset. Schema compatibility is exact for v1;
additive schema evolution requires an explicit reviewed compatibility rule.

| Candidate capability ID | Positive evidence required | Current Guffawaffle observation | Current NetniV observation |
| --- | --- | --- | --- |
| `ingest.stfc-sidecar.v1` | Runtime manifest declaration plus authenticated loopback fixture using outer `stfc.sidecar.ingest.v1` and bounded-request qualification | Current mod/Sidecar contract and tests exercise the protocol, but the Bridge runtime manifest does not declare it | No reviewed declaration |
| `battle.capture.v1` | Accepted `battle.events` payload containing `battle.capture` / `stfc.battle.capture.v1`, lossless-ID fixture, and producer version | Implemented and represented in `examples/sample-battle-events.jsonl`; not declared to Bridge | No reviewed declaration |
| `battle.report.v0` | Accepted `battle.report` / `stfc.sidecar.battle-report.v0` fixture and producer version | Implemented compatibility bundle; not declared to Bridge | No reviewed declaration |
| `battle.analytics.v0` | Accepted `battle.analytics` / `stfc.battle.analytics.v0` fixture with provenance and producer version | Implemented derived payload; not declared to Bridge | No reviewed declaration |
| `battle.catalog-snapshot.v0` | Accepted `catalog.snapshot` / `stfc.catalog.snapshot.v0` fixture with explicit coverage and unresolved IDs | Implemented and represented in the sample replay; not declared to Bridge | No reviewed declaration |
| `fleet.runtime-snapshot.v1` | Accepted `fleet.runtime` payload using `stfc.fleet.runtime_snapshot.v1`, ordering/idempotency fixture, and producer version | Implemented in the current sync path and Sidecar tests; not declared to Bridge | No reviewed declaration |
| `fleet.alert-evidence.v0` | Accepted `fleet.alert_evidence` payload using `stfc.fleet.alert_evidence.v0`, redaction fixture, and producer version | Sidecar contract/tests exist, but no matching emitter was found in the current Guffawaffle producer tree | No reviewed declaration |

The outer ingest capability is intentionally separate from each payload
family. It proves transport compatibility but does not imply that every event
family exists. Likewise, one event-family capability must never activate an
unrelated feature.

### Candidate player features

Runtime-dependent **collection** and retained-data **reading** must not be one
feature. Otherwise losing a producer capability would also hide already-owned
history. The collection features below are runtime gated; read workspaces are
packaged product behavior whose construction is additionally controlled by
player activation and whether retained/importable data exists.

| Candidate feature ID | Player outcome | Requirement and dependencies | `LauncherFeatureKind` candidate | Product default candidate | Separate player preference | Native owner and implementation | Honest fallback | Fixture/evidence gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `battle.collection` | Collect new canonical battle evidence locally | Requires `ingest.stfc-sidecar.v1` and `battle.capture.v1` | `CompatibilityGate` | `EnabledWhenEligible` | Explicit collection opt-in | Native ingest/repository transaction | No listener or new Battle writes; explain missing evidence and retain existing history | Redacted capture corpus, large IDs, duplicates, unknown versions, and current/future/partial manifests |
| `battle.history` | Browse retained/imported battles and open evidence-backed detail | No current-runtime requirement; depends on accepted stored-schema support after eligibility planning | `CompatibilityGate` | `EnabledWhenEligible` | Battle workspace activation; exact persistence belongs to #58/#71 | Native Battles workspace and repository reads | Activation/empty state without database creation; unsupported stored schema gets recovery guidance | Stored-schema, empty, imported, capability-loss, and corruption fixtures |
| `battle.workbench` | Inspect deterministic decoded battle rows and explanations | Depends on `battle.history`; no producer requirement unless #75 proves an accepted decoder input is missing from canonical capture | `CompatibilityGate` | `EnabledWhenEligible` | Inherits Battle history/workspace preference | Native Battle parser/read models | Battle detail shows canonical evidence without Workbench interpretation | Sidecar/native golden parser and detail outputs |
| `battle.report-ingest-compatibility` | Accept new producer convenience-report envelopes when present | Requires `ingest.stfc-sidecar.v1` and `battle.report.v0`; it does not own retained-report reading | `CompatibilityGate` | `EnabledWhenEligible` | None separate from collection state | Loopback ingest compatibility adapter | Reject new report envelopes while retained reports remain readable | Report fixture and parity assertions |
| `battle.analytics-ingest-compatibility` | Accept new reviewed producer-derived analytics envelopes | Requires `ingest.stfc-sidecar.v1` and `battle.analytics.v0`; it does not own retained-analytics reading | `ExperimentalFeature` | `Disabled` | None until product policy accepts the interpretation | Loopback analytics-ingest adapter | Reject new analytics envelopes while retained evidence remains readable | Analytics provenance and correction fixtures |
| `battle.catalog-snapshot-ingest` | Accept new catalog snapshots for later label resolution | Requires `ingest.stfc-sidecar.v1` and `battle.catalog-snapshot.v0`; it does not own retained-catalog reading | `CompatibilityGate` | `EnabledWhenEligible` | None separate from collection state | Loopback catalog-ingest adapter | Reject new snapshots while retained labels and exact unresolved IDs remain readable | Coverage, unresolved-ID, dedupe, and schema-version fixtures |
| `fleet.collection` | Collect new fleet runtime observations | Requires `ingest.stfc-sidecar.v1` and `fleet.runtime-snapshot.v1` | `CompatibilityGate` | `EnabledWhenEligible` | Explicit collection opt-in | Native ingest and fleet projection transaction | No fleet listener/work; retain any last-known projection explicitly as stale | Snapshot ordering, duplicate, dropped-event, reconnect, and capability-loss fixtures |
| `fleet.watch` | Show current or explicitly stale retained fleet state | Depends on accepted stored projection support after eligibility planning, not the current provider name | `CompatibilityGate` | `EnabledWhenEligible` | Battle/Fleet workspace activation; exact persistence belongs to #58/#71 | Native Fleet workspace | Activation/quiet state; retained state is clearly stale and removable | Empty, live, stale, retained, corrupt, and capability-loss fixtures |
| `fleet.recent-combat` | Correlate bounded recent combat with fleet state | Depends on `fleet.watch` and `battle.history` | `CompatibilityGate` | `EnabledWhenEligible` | None beyond dependency preferences | Native recent-combat projection | Fleet Watch remains usable without combat correlation | Frozen correlation outputs with missing/late Battle evidence |
| `fleet.local-alerts` | Create local, reviewable alert/reminder intents | New intents require `ingest.stfc-sidecar.v1` and `fleet.alert-evidence.v0`; whether it depends on `fleet.watch` is an issue #65/#75 decision | `CompatibilityGate` | `EnabledWhenEligible` | Explicit notification/alert opt-in | Native intent engine and Windows notification boundary | Evidence remains inspectable; no notification is emitted | Intent, coalescing, restart, redaction, and quiet/no-evidence fixtures |

Stored report, analytics, and catalog readers are packaged schema adapters
outside the three runtime-ingest gates above. Their availability is determined
by accepted stored-schema support and retained data after the immutable
runtime eligibility plan. Losing a producer capability can stop new envelopes
but cannot hide already readable evidence or labels.

### Gate graduation and removal contracts

- The v1 outer-ingest, canonical Battle capture, Fleet snapshot, stored-schema,
  and workspace gates are permanent compatibility contracts while those
  schema families remain supported. Removing one requires a replacement
  schema/reader and an explicit migration or unsupported-data recovery path.
- The `battle.report.v0`, `battle.analytics.v0`, and
  `battle.catalog-snapshot.v0` gates are temporary compatibility adapters.
  Each graduates to a new reviewed schema or is removed only after no accepted
  producer emits it, retained data has a reader/migration disposition, and
  #75 proves the canonical replacement preserves the required player outcome.
- `battle.analytics-ingest-compatibility` remains disabled product policy until its
  provenance and correction semantics are accepted. Enabling it requires a
  reviewed fixture decision; abandoning it removes the adapter without
  weakening canonical evidence.
- `fleet.alert-evidence.v0` does not enter an accepted catalog until #241
  supplies positive producer evidence. If that evidence is not implemented,
  the candidate gate and first-release alert feature are removed rather than
  inferred from Sidecar tests.
- Any temporary `ExperimentalFeature` or `ReleaseFlag` added during delivery
  must name its owner, expiry/review event, safe fallback, and deletion test in
  `LauncherFeatureCatalog`; indefinite anonymous flags are not accepted.

Recommended acceptance set: use the feature and capability IDs above unless
#75 finds that a boundary is not independently testable. In particular, do
not introduce `guffawaffle.*`, `netniv.*`, `battle-bridge.enabled`, or a single
`battle.all` capability.

Two IDs are deliberately unresolved:

- A `battle.home` feature ID should be accepted only after the minimum active
  feature set and the behavior for retained-history-only users are decided.
  Home selection may instead remain ordinary UI preference composed from the
  activation plan.
- Collection lifecycle may need one internal feature/implementation decision,
  but `collection active/paused` is player/runtime state and must not be
  disguised as capability evidence.

The current resolver has two planning gaps for these candidates: it is
startup-latched and binary, and it evaluates only `LauncherRuntimeProfile`
capabilities plus product policy. It does not consume player activation,
retained-data/schema state, or a distinction between "fallback usable" and
"feature unavailable." Issues #58 and #71 must either compose those state axes
outside the immutable eligibility plan or make a narrow, reason-preserving
extension. They must not encode those axes as fake runtime capabilities or
provider checks.

The candidate composition contract is recorded in
[`26-battle-bridge-state-readiness-contract.md`](26-battle-bridge-state-readiness-contract.md).
It composes preferences, collection lifecycle, retained-data readability,
provider/install trust, blockers, Home preference, recovery, and explicit
feature requests after the immutable activation plan. It does not reimplement
the resolver or elevate any candidate capability in this ledger.

## Current Guffawaffle Producer Dependency Inventory

These source observations help define #241. They are not activation evidence
until the exact build advertises accepted capabilities.

| Producer behavior | Current dependency | Capability consequence / disposition |
| --- | --- | --- |
| Authenticated local transport | `[sidecar.sync].enabled`, `url`, and `token`; optional proxy/TLS policy; bounded queue/chunk/transport code in `sidecar_local_ingest*` | Candidate `ingest.stfc-sidecar.v1`. Native activation must use the existing Bridge Data Sync mutation owner and must never log or fixture the token. |
| Canonical Battle event delivery | `[sidecar.sync].battlelogs_realtime = true`; canonical capture/report/analytics/catalog payloads additionally rely on `[sidecar.sync].battlelog_enrichment = true` and Battle-log decode/export seams | Advertise each accepted event-family capability separately. Do not infer analytics, report, or catalog support from capture support. |
| Fleet runtime delivery | `[sidecar.sync].fleet_runtime = true`; normal capture uses the reviewed Fleet-bar transition seam and `patches.fleetarrivalhooks`; `fleet_runtime_mode` values `request_only`, `snapshot_only`, and `enqueue_no_transport` are diagnostics/probe behavior | Candidate `fleet.runtime-snapshot.v1`. Diagnostic modes are not player capabilities and must not enter a release manifest. |
| Optional JSONL capture | `[sidecar.logging].jsonl`, `jsonl_replay_seconds`, and `jsonl_recent_logs` | Migration/fixture-only. JSONL is not required for native runtime eligibility or normal storage. |
| Fleet alert evidence | Sidecar schema/tests recognize `fleet.alert_evidence`, but the current Guffawaffle producer tree has no matching emitter | Candidate remains unsupported/unproven. #241 must either add and qualify a bounded producer contract or remove it from the first accepted feature set. |
| Legacy/external `[sync]` targets | Separate battle/fleet/cloud transport and observer paths | Not Battle Bridge capability evidence. Local Battle activation must use only the canonical `[sidecar.sync]` target contract. |

## Current Provider And Build Evidence

This table is descriptive and must not be compiled into eligibility policy.

| Case | Runtime evidence | Expected feature result |
| --- | --- | --- |
| Current packaged Guffawaffle fixture | Positively identifies Guffawaffle and only `settings.principal-taxonomy.v1` | Semantic settings grouping is eligible. All candidate Battle features remain ineligible until #241 publishes and #75 qualifies positive Battle capabilities. |
| Current reviewed NetniV release | Provider release/trust/configuration evidence exists; runtime manifest capability is `unknown` | Base Bridge remains healthy. Semantic grouping and candidate Battle features fail closed individually without calling NetniV broken. |
| Future compatible NetniV build | Hypothetical valid runtime manifest declaring a reviewed subset of candidate capabilities | Exactly the corresponding features become eligible. No provider switch or renderer change is required. |
| Partial-capability build | Valid manifest declares only a subset | Each feature resolves independently; dependency failures select their documented fallback. |
| Old or unsupported manifest | Manifest missing required capability or using an unsupported schema | Only positively normalized capabilities are usable; affected features are inactive with evidence reasons. |
| Unknown/custom DLL | No attributable compatible runtime manifest | No runtime-dependent feature is inferred. Existing history remains readable where its stored schema is supported. No artifact is replaced silently. |
| Capability lost after update/switch | New trusted runtime no longer declares a previously used capability | New dependent collection stops. Retained history and independent features remain available; deletion is a separate player action. |

## Native Mod Bridge Foundation Disposition

These are baseline shared capabilities, not Battle feature candidates. Battle
composition must reuse their current transaction, trust, state, and
accessibility owners.

| Foundation surface | Disposition | Continuity evidence / retirement gate |
| --- | --- | --- |
| Game discovery, validated install selection, process state, launch handoff | Shared foundation | Existing Bridge core and local-game integration tests remain authoritative. Battle work must not introduce another game detector or launcher. |
| Home health and game/mod/provider status | Shared foundation | Both Home presentations use the same health snapshot; a running game and active collection are normal states. |
| Provider selection, release discovery, artifact authentication, install/update/repair/remove | Shared foundation | Existing reviewed provider packs and `ModManagementCoordinator` transaction remain sole authority. |
| Provider switch, protected TOML history, recovery journal, operation lock | Shared foundation | Any feature-requested provider transition uses the existing preview, game-closed exclusion, atomic switch, rollback, and recovery. |
| Sparse TOML Settings, semantic/alphabetical layout, hotkeys, notifications, staged Save/Discard | Shared foundation | One configuration workspace/repository remains authoritative. Battle adds no general TOML editor. |
| Data Sync topology and local Sidecar destination | Shared foundation, extend narrowly | Existing target contract owns TOML. Battle activation may request a reviewed local target mutation; it does not write TOML directly. |
| Diagnostics, redaction, support export, effective-config warning, recovery actions | Shared foundation, extend narrowly | Battle contributes bounded evidence through existing diagnostics contracts. Raw evidence requires a separate deliberate export. |
| Window shell, theme, accessibility, navigation, UI preferences | Shared foundation | Native WPF composition reuses focus, sizing, reduced-motion, keyboard, screen-reader, and DPI behavior. |
| Launcher signing, MSIX/App Installer update, attestations, SBOM, release verification | Shared foundation | Selected #66 package topology must reuse one accepted release authority; Sidecar signing/updating receives no trust inheritance. |

## Legacy Sidecar Player-Surface Disposition

Each legacy surface has exactly one disposition from the issue #55 vocabulary.

| Sidecar surface | Disposition | Native outcome / retirement gate |
| --- | --- | --- |
| `/`, `/home/` landing and status cards | Retire after replacement | Native Battle Home and shared Bridge health must cover accepted outcomes before browser markup is removed. |
| `/fleet/` Fleet Watch | Port for v1 | Port fleet projection, freshness, activity, recent combat, and accepted alert intent behavior behind candidate Fleet features. |
| `/battle-log/` history and detail | Port for v1 | Native Battles workspace reads indexed canonical storage without materializing every raw payload. |
| `/battle-log/workbench/` | Port for v1 | Port only deterministic, fixture-backed parsing and progressive evidence disclosure. |
| `/settings/` hotkeys, notifications, diagnostics settings | Retire after replacement | Native Bridge Settings is authoritative; preserve only accepted Battle-local preferences outside mod TOML. |
| `/setup/` and About setup surface | Retire after replacement | Native Bridge provider/mod lifecycle and feature activation replace setup/profile flows. |
| `/diagnostics/` | Diagnostics-only | Port Battle health, storage, ingest, parser/projection, and privacy evidence into native Diagnostics; do not port the browser workspace. |
| `/diagnostics/cloud-sync/` | Deferred | Cloud egress is outside v1 and requires a new privacy/product decision. |
| `/diagnostics/observed-hostiles/` | Deferred | Preserve research artifacts and fixtures; no v1 primary navigation or capability claim. |
| `/majel/` raw ingest viewer | Diagnostics-only | Preserve bounded envelope fixtures and redacted troubleshooting evidence; no generic raw viewer in normal navigation. |
| `/aria/` | Deferred | No v1 cloud/AI assistant or provider-credential surface. |
| `/about/` release/profile metadata | Retire after replacement | Native About/release evidence remains authoritative. |
| Root legacy viewer landing page | Retire with reason | Browser/server discovery shell conflicts with the native single-product architecture. |

## Legacy Route Disposition

Routes are grouped only where ownership, disposition, and retirement gate are
identical. Dynamic detail routes are included with their collection route.

| Routes | Disposition | Notes / replacement |
| --- | --- | --- |
| `/api/sidecar/ingest` | Port for v1 | Preserve only the accepted authenticated outer protocol/kinds required by candidate features; native loopback host is the sole compatibility boundary. |
| `/api/battles`, `/api/battles/{battleKey}`, `/api/events`, `/api/events/{sequence}`, `/api/events/stream` | Retire after replacement | Native view models query native repository/read services directly. Preserve behavior, including legacy event POST, as fixtures rather than a localhost application API. |
| `/api/fleet/sync` | Migration/fixture-only | Old alternate ingest semantics become producer/consumer test evidence; canonical native ingest remains `/api/sidecar/ingest`. |
| `/api/fleet/activity`, `/api/fleet/alert-intents`, `/api/fleet/projection`, `/api/fleet/ship-combat-preview`, `/api/fleet/stream` | Retire after replacement | Native direct services replace browser read/stream routes after golden-output parity. |
| `/api/majel/ingest`, `/api/majel/events`, `/api/majel/events/{id}`, `/api/majel/stream` | Diagnostics-only | Preserve bounded `majel.ingest.v1` validation fixtures where useful; do not keep a second production ingest/read API. |
| `/api/settings/hotkeys`, `/api/settings/notifications`, `/api/settings/diagnostics` | Retire after replacement | Bridge configuration workspace and schema/catalog adapters are authoritative. |
| `/api/mod/release-catalog`, `/api/mod/install-plan`, `/api/mod/verify-artifact`, `/api/mod/install-preflight`, `/api/mod/stage-artifact`, `/api/mod/install-confirmation`, `/api/mod/install-execution` | Retire after replacement | Existing native provider/release/trust/deployment transactions replace the complete group. |
| `/api/mod/uninstall-plan`, `/api/mod/uninstall-confirmation`, `/api/mod/uninstall-execution` | Retire after replacement | Existing native managed removal and recovery remain sole authority. |
| `/api/release/check` | Retire with reason | Windows/MSIX App Installer and Bridge release authority own product update. |
| `/api/diagnostics/bundle` | Diagnostics-only | Port safe contributors/redaction to native Diagnostics, then retire HTTP response shape. |
| `/api/health/ready`, `/api/health` | Diagnostics-only | Port bounded Battle subsystem health into native health contributors; no public local health server. |
| `/api/admin/shutdown` | Retire with reason | Native lifecycle owns shutdown; no HTTP administration route. |
| `/api/dev/ax`, `/api/dev/status` | Migration/fixture-only | Preserve useful diagnostic scenarios and scripts outside the production runtime. |
| `/api/observed-hostiles`, `/api/observed-hostiles/community-report`, `/api/observed-hostiles/catalog-entries`, `/api/observed-hostiles/observations` | Deferred | Research scope only; no v1 native routes or UI. |

## Event, Storage, And Data Disposition

| Legacy item | Disposition | Owner / migration rule / gate |
| --- | --- | --- |
| `battle.capture` / `stfc.battle.capture.v1` | Port for v1 | Canonical lossless Battle evidence; producer capability and redacted golden fixture required. |
| `battle.report` / `stfc.sidecar.battle-report.v0` | Migration/fixture-only | Compatibility import/render path; never preferred over canonical capture. |
| `battle.analytics` / `stfc.battle.analytics.v0` | Migration/fixture-only | Optional derived evidence; do not treat labels/math as authority without provenance fixtures. |
| `catalog.snapshot` / `stfc.catalog.snapshot.v0` | Port for v1 | Content-address and deduplicate; unresolved facts remain explicit. |
| Transitional `battle.event` | Migration/fixture-only | Accept only for legacy import/replay where bounded; no new producer dependency. |
| `fleet.runtime` / `stfc.fleet.runtime_snapshot.v1` | Port for v1 | Canonical Fleet projection input when positively advertised. |
| `fleet.alert_evidence` / `stfc.fleet.alert_evidence.v0` | Port for v1 | Observation-only alert input; never gameplay command authority. |
| `debug.event`, `hook.event`, `session.event` | Diagnostics-only | Safe bounded health/testing evidence only; not required for player Battle features. |
| `integration.event` | Deferred | External integration/provider work is outside v1. |
| `observed.hostile` / `stfc.observed.hostile.v0` | Deferred | Preserve research contract and fixtures; no v1 collection requirement. |
| `sidecar_events` SQLite/PostgreSQL table | Migration/fixture-only | Read transactionally during legacy migration. Native v1 schema is SQLite-only, compressed/indexed, and independently versioned. PostgreSQL is not ported. |
| Fleet broker raw table | Migration/fixture-only | Import only accepted payload families; preserve raw source until migration receipt succeeds. |
| Fleet broker projection table | Migration/fixture-only | Compare outputs, then rebuild native projections from canonical accepted evidence where possible. |
| Fleet broker outbox table | Deferred | Cloud upload is outside v1; do not import pending/sent authority into native runtime. |
| In-memory Majel envelope store | Diagnostics-only | Useful for bounded fixtures; not durable or authoritative. |
| JSONL feed and replay reader | Migration/fixture-only | Keep explicit import/test tooling only. JSONL is not normal runtime storage or an unbounded parallel history. |
| `community_patch.log` tail | Diagnostics-only | Preserve bounded/redacted support contribution; never infer hook health beyond explicit evidence. |
| Sidecar desktop/profile/settings JSON | Migration/fixture-only | Import only accepted Battle preferences. Do not import provider, install, updater, cloud, or credential authority. |
| Sidecar sync token | Retire after replacement | Rotate/bootstrap through the native activation transaction; never migrate secret bytes into fixtures, logs, or diagnostics. |

## Module, Script, And Fixture Disposition

| Inventory | Disposition | Gate |
| --- | --- | --- |
| `packages/core/src/battle-log` parser | Port for v1 | Freeze accepted outputs first; native code owns production behavior. |
| `packages/core/src/broker` fleet projection/recent-combat | Port for v1 | Freeze ordering, freshness, idempotency, and correlation outputs. |
| `packages/core/src/alerts` intent projection | Port for v1 | Freeze intent/coalescing behavior; notification delivery remains native. |
| `packages/core/src/storage` SQL event store | Migration/fixture-only | Reuse behavioral tests and migration reads, not PostgreSQL or the uncompressed schema. |
| `packages/core/src/settings` | Retire after replacement | Bridge Settings/catalog remains authoritative after parity review. |
| `packages/viewer` server, route modules, static/browser UI | Retire after replacement | Remove only after native domain and diagnostic parity; retain selected fixtures separately. |
| `packages/desktop` Electron shell, IPC, setup, release update, NSIS | Retire with reason | Native signed Bridge/MSIX architecture supersedes the production shell. |
| Mod install/update/uninstall/profile modules and install smoke scripts | Retire after replacement | Native lifecycle qualification must cover player outcomes before removal. |
| Server/desktop lifecycle scripts (`viewer-server-control`, `desktop-dev`, `desktop-lifecycle-ax`) | Retire with reason | They exist only for the legacy runtime. |
| `repro-bundle-ax` | Diagnostics-only | Preserve safe scenarios until native diagnostic-export qualification supersedes them. |
| `analyze-attack-scalars` | Migration/fixture-only | Preserve deterministic research input/output; not a shipped player feature. |
| `observed-hostile-ax` and hostile reference builder/pack | Deferred | Keep research history discoverable without entering v1 production scope. |
| `examples/sample-battle-events.jsonl` and sample battle log | Migration/fixture-only | Seed #75 after redaction/version review; supplement missing Fleet/error/version cases. |
| `examples/sample-debug-events.jsonl` | Diagnostics-only | Use only for bounded diagnostics fixtures. |
| `examples/sidecar-local-config.example.json` | Retire with reason | Unsafe hash/profile override is not a native capability contract. |
| Inline parser, store, broker, Fleet, alert, route, security, and desktop tests | Migration/fixture-only | Extract accepted inputs/outputs into portable, versioned golden corpus before deleting production modules. |
| Electron/NSIS signing and release QA documents/scripts | Retire with reason | They confer no trust on native artifacts; retain historical commits only. |

## Evidence And Fixture Requirements

Issue #75 should create a bounded, runtime-independent corpus with:

1. Runtime manifests for current Guffawaffle, current NetniV, future compatible
   NetniV, partial capability, old/unsupported schema, unknown/custom, and
   capability-loss cases.
2. At least one secret-reviewed valid and invalid example for every accepted
   outer ingest kind and schema version.
3. Expected `LauncherFeatureDecision` state, reason category, selected active
   implementation, fallback, and dormant-runtime effect for each manifest.
4. Accepted Sidecar/native outputs for Battle history/detail/Workbench, Fleet
   projection/freshness/recent combat, and alert intents.
5. Large identifiers, unknown additive fields and enums, duplicates,
   out-of-order input, missing optional families, oversized input, token
   redaction, reconnect, and retained-history-after-capability-loss cases.

Current reusable evidence is incomplete:

- `examples/sample-battle-events.jsonl` covers capture, report, analytics,
  catalog snapshot, and transitional battle events, but not Fleet runtime or
  alert evidence.
- Fleet, alert, SQL, route, and authentication cases are mostly inline test
  data rather than one portable golden corpus.
- The Bridge's bundled runtime fixture declares no Battle capability.
- The legacy profile map (`settings`, `installStatus`, `notifications`,
  `battleLog`, `eventStore`) is owner/profile-derived and therefore cannot be
  migrated as eligibility evidence.
- No current fixture proves compatible future NetniV, partial-capability,
  capability-loss, or retained-history behavior.

## Replacement And Retirement Rules

Legacy deletion is permitted only when all applicable gates are recorded:

1. The stable candidate IDs have principal acceptance and checked-in native
   definitions with requirements, dependencies, policy, implementations, and
   fallbacks.
2. Positive producer evidence is published by the exact build and normalized
   by the runtime detector; repository/profile/display-name inference is not
   accepted.
3. Golden fixtures prove native parity or record an intentional correction.
4. Native packaged security, accessibility, performance, migration, and
   recovery qualification passes.
5. Legacy state is retained until a verified migration receipt exists; source
   deletion is always a separate explicit decision.
6. Sidecar release/signing/update/profile/configuration authority is not
   imported into Bridge.

Until then, this repository remains the discoverable donor and migration
source. It is not the production Battle Bridge architecture.
