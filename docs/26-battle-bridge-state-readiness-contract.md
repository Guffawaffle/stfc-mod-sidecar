# Battle Bridge State, Readiness, And Provider-Transition Contract

Status: candidate planning contract for issues #58 and #71. It defines the
handoff to native Bridge composition; it does not accept a runtime capability,
add a feature to `LauncherFeatureCatalog`, or implement runtime behavior.

## Purpose

Battle Bridge is one native application with independently useful Battle
features. A feature can be eligible without being enabled, enabled without
currently collecting, unable to collect while retained data stays readable,
or blocked by a recoverable transaction without becoming unsupported.

This contract composes those operational facts **after**
`LauncherFeatureResolver` produces its immutable, reason-bearing
`LauncherActivationPlan`. It must not inspect provider names, re-evaluate
capability requirements, or become a second resolver.

Base Mod Bridge Home, Settings, Diagnostics, provider lifecycle, and game
launch remain available regardless of Battle readiness.

## Authorities And Independent Axes

The native implementation should capture one immutable composition snapshot.
Every input below retains its own authority and diagnostic representation.

| Axis | Candidate structured values | Authority and rule |
| --- | --- | --- |
| Resolver decision | `active`, `inactive`; feature ID, selected implementation, typed reason, reason evidence, and exact policy disposition/source | `LauncherActivationPlan`. This is the only feature-eligibility decision. Composition consumes it without recalculating capabilities, dependencies, or policy. |
| Product-policy evidence | Decision disposition `catalog-default-enabled`, `catalog-default-disabled`, `checked-in-override-enabled`, or `checked-in-override-disabled`, plus the plan's stable checked-in policy source/version | `LauncherFeatureResolver` records the feature definition's `LauncherFeatureDefault` and exact checked-in `LauncherFeaturePolicy` source while building the plan. The composer receives no separate policy input and cannot reconstruct or override it. No runtime, remote, provider, or player-owned override authority is introduced. |
| Player preference | `not-applicable`, `unset`, `enabled`, `disabled` | Launcher-owned local preference for that optional feature. It cannot elevate an inactive resolver decision. `unset` is not consent. |
| Collection operation | `not-applicable`, `dormant`, `starting`, `active`, `paused`, `blocked`, `stopping` | Native collection coordinator. Recovery is supplied only by the recovery axis. This is runtime state, never a capability or provider-pack property. Collection state is per feature family, not one provider-wide Battle switch. |
| Retained data | `none`, `present` | Native repository inventory. Data presence does not prove current producer compatibility. |
| Stored-schema readability | `not-applicable`, `readable`, `migration-required`, `unsupported`, `corrupt` | Versioned native repository/schema adapters. Current runtime capability loss must not rewrite this result. |
| Selected provider | resolved provider/channel, unresolved selection, or custom/unselected | Existing provider-selection resolution. This governs release/configuration authority, not feature availability. |
| Installed artifact | existing `ModInstallationEvidenceState`, installed provider/runtime identity, exact hash, and game-running observation | Existing local-health and provenance services. `ManagedVerified` is required before Bridge mutates a managed provider installation. Runtime capability evidence remains descriptive compatibility, not authenticity proof. |
| Transition evidence | `none`, `discovery-lead`, `artifact-qualified`, or `temporarily-unavailable`; an artifact-qualified entry carries target provider/channel, exact artifact identity/hash, verified trust evidence, artifact-bound normalized `LauncherRuntimeProfile`, target `LauncherActivationPlan`, and exact requested-feature decision | Provider catalog/release discovery may locate an artifact but cannot assert feature eligibility. Only the existing runtime detector plus `LauncherFeatureResolver` applied to the exact verified target artifact can qualify it. A qualified target is feature-specific and is not permission to switch. |
| Transaction blockers | game `closed`/`running`; staged edits `none`/`present`; restart `not-required`/`required`; operation `idle`/`active` | Existing game-process, configuration edit-session, deployment lock, restart, and recovery journal owners. Recovery is supplied separately. Blockers pause an action; they do not change eligibility. |
| Home preference | `unset`, `base`, `battle` | Launcher-owned UI preference. It is not a feature flag and is never inferred from provider identity. |
| Recovery evidence | Zero or more owner records with stable owner ID, affected feature/domain IDs, `none`, `available`, `required`, `in-progress`, or `failed`, transaction/reference ID, bounded action, mutation-block effect, and safe-read effect | Existing provider/deployment/storage recovery owners. Each projection considers only applicable owners; the composer normalizes concurrent records but does not run recovery or invent owner priority. |
| Battle Home policy | Stable checked-in policy ID/version, contributing feature/workspace IDs, and explicit offer predicate | Product catalog metadata accepted through #55/#75. The composer does not infer usefulness from labels, provider, or subjective action text. Until a baseline is accepted, Battle Home is not automatically offered. |
| Interaction | `passive`, `explicit-feature-request` with requested feature ID | The current user action. Provider-transition review is legal only for an explicit request for that same unavailable feature. |

Implementations may use native enum and record names that fit Bridge style, but
must preserve these distinctions. In particular, do not flatten the snapshot
into `battleEnabled`, `providerSupportsBattle`, or a profile-derived readiness
boolean.

The immutable resolver contract needs typed values before #132 composes it:

- reason: `eligible`, `policy-disabled`, `missing-capability`, or
  `dependency-inactive`, with sorted missing capability/dependency IDs where
  applicable;
- policy disposition: `catalog-default-enabled`,
  `catalog-default-disabled`, `checked-in-override-enabled`, or
  `checked-in-override-disabled`; and
- policy source: stable checked-in policy ID plus version or content digest on
  the activation plan.

These values are produced once by `LauncherFeatureResolver`. They accompany
the existing support prose; the composer never derives them from that prose or
from a second copy of the policy map.

The disposition mapping matches the current `LauncherFeaturePolicy` contract:
absence of an override records the feature definition's enabled/disabled
`LauncherFeatureDefault`; presence of a `true`/`false` checked-in override
records `checked-in-override-enabled`/`checked-in-override-disabled`. The
composition root must attach the checked-in policy source/version used for the
whole plan. There is no fifth “effective” or runtime override source.

## Deterministic Composition Output

The composer produces one read-only projection per feature and one aggregate
Home projection. It does not start listeners, save preferences, mutate TOML,
or execute a provider switch.

### Per-feature projection

| Field | Values and meaning |
| --- | --- |
| `eligibility` | `eligible` only when the resolver decision is active; otherwise `ineligible`. |
| `resolverReason` | The typed reason and exact reason evidence already carried by `LauncherFeatureDecision`. Friendly copy is selected from the typed value; UI does not parse resolver prose. |
| `policyDisposition` | The decision's exact catalog-default/checked-in-override disposition and the plan's policy source/version. The composer does not receive the mutable construction input. |
| `preferenceState` | The unchanged player-preference input plus whether consent is still required. |
| `recoveryState` | Exactly one normalized value: `none`, `available`, `required`, `in-progress`, `failed`, or `contract-error`, with all applicable owners retained. |
| `collectionState` | Exactly one total value from the collection table below. Reader-only features use `not-applicable`. |
| `readerState` | Exactly one total value from the reader table below. Collection-only features use `not-applicable`; a combined workspace still keeps both projections. |
| `primaryAction` | Zero or one safe next action. |
| `secondaryActions` | Additional non-destructive actions in stable priority order. |
| `transitionOffer` | `hidden`, `review-unavailable`, or `review-available`. `review-unavailable` additionally carries `discovery-lead` or `temporarily-unavailable`. It never means approved or executed. |
| `automationStatus` | A complete, non-color status phrase including feature name, operational state, and blocking reason when present. |

### Mutually exclusive, total collection output

Every collection feature receives exactly one value. `retained-history-only`
is deliberately absent: retained reads do not become collection state.

| Collection state | Deterministic source |
| --- | --- |
| `not-applicable` | The feature has no collection implementation. |
| `contract-error` | Owner inputs contradict the immutable plan or each other, or a required typed field is absent. No mutation action is exposed. |
| `recovery-failed` | Highest normalized recovery severity is `failed`. Safe reads follow their independent reader projection. |
| `recovering` | Highest normalized recovery severity is `in-progress`. |
| `recovery-required` | Highest normalized recovery severity is `required`. |
| `recovery-available` | Highest normalized recovery severity is `available` and an applicable owner explicitly blocks collection mutation. Non-blocking maintenance remains `recoveryState=available` plus a secondary action while ordinary collection state continues. |
| `unavailable` | Resolver decision is inactive after recovery normalization. |
| `disabled` | Resolver decision is active and optional player preference is explicitly disabled. |
| `available` | Resolver decision is active and optional player preference is unset. |
| `blocked` | Resolver decision and preference permit the requested operation, but the normalized blocker list is non-empty. |
| `dormant` | Resolver decision is active, preference is `enabled` or `not-applicable`, no blocker/recovery exists, and coordinator input is `dormant`. Player copy says “Enabled” only for preference `enabled`; a non-optional feature uses feature-specific “Ready” copy. |
| `starting` | Same preconditions as `dormant`; coordinator input is `starting`. |
| `active` | Same preconditions; coordinator input is `active`. |
| `paused` | Same preconditions; coordinator input is `paused`. |
| `stopping` | Same preconditions; coordinator input is `stopping`. Completion projects to `dormant`, `disabled`, or `unavailable` from the next immutable snapshot. |

An input `blocked` collection state without at least one normalized blocker is
`contract-error`. An input `starting` or `active` while the resolver decision
is inactive, consent is absent, or required recovery exists is also
`contract-error`; the composer does not silently reinterpret impossible owner
state. `stopping` may coexist with newly inactive eligibility only when the
coordinator supplies the prior-plan/stop transaction reference; it remains
`stopping` until the coordinator confirms quiescence.

### Mutually exclusive, total retained-reader output

Every workspace reader receives exactly one value independently of collection.

| Reader state | Deterministic source |
| --- | --- |
| `not-applicable` | The feature has no retained-data reader. |
| `contract-error` | Data/schema/recovery evidence contradicts itself or lacks required typed identity. |
| `recovery-failed` | Applicable storage recovery is failed **and** that owner explicitly blocks reads. If reads remain safe, `recoveryState=failed` accompanies the ordinary reader state. |
| `recovering` | Applicable storage recovery is in progress **and** that owner explicitly blocks reads. If reads remain safe, `recoveryState=in-progress` accompanies the ordinary reader state. |
| `recovery-required` | Applicable storage recovery is required **and** that owner explicitly blocks reads. If reads remain safe, `recoveryState=required` accompanies the ordinary reader state. |
| `recovery-available` | Applicable storage recovery is available **and** that owner explicitly blocks reads. If reads remain safe, `recoveryState=available` accompanies the ordinary reader state. |
| `empty` | Retained-data inventory is `none` and schema state is `not-applicable` or initialized/readable. No database is created merely to produce this state. |
| `readable` | Retained data is present and its exact stored schema is supported. |
| `migration-required` | Retained data is present and a reviewed migration is required before reads. |
| `unsupported` | Retained data is present and no reader/migration in this Bridge version supports it. |
| `corrupt` | Retained evidence says the store cannot be read safely. |

A collection feature with coordinator input `not-applicable`, or a reader with
`present` data and `not-applicable` schema identity, is `contract-error`.
Likewise, `none` data paired with `migration-required`, `unsupported`, or
`corrupt` schema evidence is contradictory. These rules make every typed input
vector total without guessing an owner correction.

Safe-read effect is evaluated for **every** recovery severity. `available`,
`required`, `in-progress`, and `failed` never hide an otherwise safe reader
unless an applicable owner explicitly sets read effect to `blocked`. Recovery
state, copy, and actions still show beside the independent `empty`, `readable`,
`migration-required`, `unsupported`, or `corrupt` reader result.

### Mutually exclusive, total workspace summary

The workspace summary combines collection and reader projections for concise
Home/navigation copy without overwriting either one. Exactly one value is
selected in this order:

| Workspace summary | Predicate |
| --- | --- |
| `contract-error` | Any contributing projection is `contract-error`. |
| `recovery-failed` | No contract error; any contributing projection is `recovery-failed`. |
| `recovering` | No higher state; any contributing projection is `recovering`. |
| `recovery-required` | No higher state; any contributing projection is `recovery-required`. |
| `recovery-available` | No higher state; any contributing projection is `recovery-available`. |
| `live` | Any collection is `active`. |
| `changing` | No collection active; any collection is `starting`, `stopping`, or `blocked`. |
| `paused-with-history` | A collection is `paused` and a reader is `readable`. |
| `ready-with-history` | A reader is `readable` and a collection is `available` or `dormant`. |
| `retained-history-only` | A reader is `readable` and every contributing collection is `not-applicable`, `unavailable`, or `disabled`. |
| `history-needs-action` | A reader is `migration-required`, `unsupported`, or `corrupt`. |
| `available-empty` | No retained data needs action and at least one collection is `available`, `dormant`, or `paused`. |
| `unavailable-empty` | No prior predicate matches. |

This aggregate is presentation evidence only. It is not written back as a
feature, capability, preference, collection state, or schema state.

### Stable player vocabulary

| Term | Exact use |
| --- | --- |
| **Available** | Resolver eligibility is active and optional player consent is exactly `unset`. No other state uses this label. |
| **Enabled** | Resolver eligibility is active, player consent is exactly `enabled`, and the collection coordinator is exactly `dormant`. No claim is made that collection is active. |
| **Starting** | The native coordinator accepted the start and has not yet reported active collection. |
| **Active** | The native implementation is currently performing the promised operation. Use ordinary healthy/success presentation. |
| **Paused** | The player or lifecycle coordinator intentionally stopped new work while preserving configuration and data. |
| **Stopping** | The native coordinator is quiescing new work and preserving committed data. |
| **Unavailable** | The resolver selected the feature fallback. The reason states missing evidence, product policy, or dependency without describing the whole mod/provider as broken. |
| **Blocked** | The feature is eligible or enabled, but a game/restart/edit/operation precondition prevents the requested transition. The blocker gets a direct recovery action. |
| **Recovery available/required/in progress/failed** | Exact normalized recovery state. Do not collapse failure into “needs attention” or offer competing setup/switch actions. |
| **Retained history only** | An aggregate workspace/Home summary only: every contributing collection is unavailable, disabled, or not applicable, and at least one retained reader is `readable`. The underlying collection and reader states remain visible separately. |

`Available`, `Enabled`, `Starting`, and `Active` are not synonyms. A running
game and an active collector are normal healthy states, not warnings.

### Normalization And Precedence

1. Require the activation plan to carry a typed resolver reason, typed policy
   disposition, and stable policy source/version. Missing or internally
   inconsistent decision evidence yields `contract-error`; the composer never
   reconstructs policy from defaults, overrides, or prose.
2. Filter recovery records to owners that explicitly affect the feature/domain
   being projected, then normalize by stable owner ID. Duplicate/conflicting
   records for one owner yield `contract-error`. Across applicable owners,
   severity is
   `failed` > `in-progress` > `required` > `available` > `none`. All owners at
   the selected severity are retained and sorted by owner ID. Action semantics
   are fixed by severity: `available` uses primary `Review recovery`;
   `required` uses primary `Recover`; `in-progress` exposes status/progress and
   **no action**; `failed` uses primary `View recovery details` and may expose an
   owner-declared safe `Retry` only as a secondary action. `required`,
   `in-progress`, and `failed` suppress new mutation in every affected domain.
   An `available` record suppresses mutation only when its owner sets the typed
   mutation-block effect; non-blocking maintenance remains a secondary
   `Review recovery` action and does not replace ordinary collection state.
   Globally, if **any** applicable recovery owner is `in-progress` or an
   applicable operation owner reports an active transaction, suppress every
   recovery mutation action—including `Recover` and `Retry`—regardless of which
   severity wins presentation. Only status/progress, details, safe reads, and
   other read-only actions remain. This prevents a higher-ranked failed owner
   from competing with work that is already in progress.
3. Normalize transaction blockers independently. Duplicate/conflicting owner
   records yield `contract-error`. For a mutation request the deterministic
   action order is: existing operation in progress, staged Settings edits,
   pending restart, game running, then artifact/source repair. Every blocker is
   retained in diagnostics; only the first actionable category supplies the
   primary action.
4. Produce the reader projection from retained-data, exact schema, and only
   storage-owner recovery. Provider capability and collection lifecycle cannot
   hide or elevate readable data.
5. Produce the collection projection using the precedence encoded in the
   total table above: contract error, normalized recovery, inactive resolver
   decision, player preference, normalized blockers, then coordinator state.
6. Evaluate transition discovery only for an `explicit-feature-request` whose
   exact requested decision is inactive for typed `missing-capability`. A
   discovery lead may trigger bounded artifact acquisition/verification, but
   `review-available` requires an exact verified artifact-bound target profile
   and an existing `LauncherFeatureResolver` target decision that is active for
   that same feature. Policy-disabled, dependency-only, preference-disabled,
   passive, recovery, and retained-data-only cases never qualify a transition.
7. Compute workspace/Home summaries from the separate feature, collection, and
   reader projections plus accepted checked-in Home policy metadata. Do not
   read provider identity or action-copy text.

If owner-produced fields contradict—for example, a decision says active while
its own carried policy disposition says disabled—the composer returns a
contract-error diagnostic and exposes no mutation action. It still does not
re-resolve the feature.

## User-Safe Reasons, Copy, And Actions

The reason category is stable for tests and diagnostics. Copy can be localized
without changing semantics.

| Reason category | Player-safe meaning | Primary action | Prohibited implication |
| --- | --- | --- | --- |
| `ready-to-enable` | “This feature is available. Turn it on when you’re ready.” Consent is exactly `unset`. | `Enable` | Do not imply consent from eligibility. |
| `enabled-ready` | “This feature is on and ready.” Consent is `enabled` and coordinator is `dormant`. | Feature-specific `Start` or `Open` | Do not claim collection is active or use this category for `unset`. |
| `collection-starting` | “Starting collection…” | Bounded `Cancel` only when coordinator supports it | Do not claim active before coordinator evidence. |
| `collecting` | “Collecting new data while you play.” | `Pause` | Do not show warning/yellow merely because the game is running. |
| `player-paused` | “Collection is paused. Your saved history is unchanged.” | `Resume` | Do not describe paused as unsupported. |
| `collection-stopping` | “Stopping collection safely…” | Progress/status | Do not report quiescent until coordinator evidence. |
| `player-disabled` | “This feature is off. Saved history is unchanged.” | `Enable` | Do not delete retained data. |
| `capability-unavailable` | “This installed mod doesn’t provide this feature yet.” | `Review compatible mod option` only when an explicit request has a reviewed candidate | Do not say the provider or mod is unhealthy. |
| `transition-discovery-lead` | “Bridge found a possible mod option and needs to verify its exact download.” | Primary `Check compatible mod option`; secondary `Learn more` | This is `review-unavailable`, not compatibility proof or a switch preview. |
| `transition-temporarily-unavailable` | “Bridge couldn’t verify a compatible mod option right now.” | Primary `Retry`; secondary `Learn more` | Preserve the installed feature result; do not reuse a stale lead or show `Review`. |
| `transition-qualified` | “Bridge verified a mod option that provides this feature.” | Primary `Review compatible mod option`; secondary `Learn more` | This is a review invitation for one exact artifact, not consent or execution. |
| `policy-disabled` | “This Bridge version does not currently enable this feature.” | `Learn more` | Do not offer a provider switch; another provider cannot override product policy. |
| `dependency-unavailable` | “This feature needs another Bridge feature first.” | Open the dependency when actionable | Do not treat the provider as the remedy unless the dependency’s own explicit request qualifies. |
| `close-game` | “Close the game to make this change safely.” | `Check again` after the player closes it | Do not stop the game automatically. |
| `save-or-discard-edits` | “Finish your Settings changes before changing the mod.” | `Review changes` | Do not discard edits automatically. |
| `restart-required` | “Restart the game to finish enabling this feature.” | Existing safe restart/launch action | Do not claim the old process has adopted the new runtime. |
| `operation-in-progress` | “Another Bridge change is still finishing.” | `View progress` | Do not start a competing mutation. |
| `recovery-available` | “Bridge found a recovery action you can review.” | `Review recovery` is primary when mutation-blocking and secondary when non-blocking | Do not pick an owner action from copy order. |
| `transaction-recovery` | “Bridge needs to restore the last change before continuing.” | Primary `Recover` only when no applicable recovery/operation is in progress; otherwise read-only progress/details | Do not offer another provider switch or execute an owner implicitly. |
| `recovery-in-progress` | “Bridge is recovering the last change.” | No action; status/progress only | Do not show `Open recovery`, `Recover`, or run a competing mutation. |
| `recovery-failed` | “Bridge could not recover the last change automatically.” | Primary `View recovery details`; optional safe owner `Retry` is secondary only when no applicable recovery/operation is in progress | Do not hide the failed owner or retry silently. |
| `contract-error` | “Bridge found conflicting status information and will not make changes.” | Diagnostics/support details | Do not guess, mutate, or parse prose to repair it. |
| `history-readable` | “Saved Battle data is available.” | `Open Battles`/`Open Fleet Watch` | Do not require a current producer capability to read it. |
| `history-migration-required` | “Saved Battle data needs an upgrade before it can open.” | `Review upgrade` | Do not migrate or delete automatically. |
| `history-unsupported` | “This Bridge version can’t read this saved data.” | `Export support details`/documented compatible-version guidance | Do not call it empty. |
| `history-corrupt` | “Saved Battle data needs repair.” | `Repair` or safe export/recovery | Do not silently recreate an empty store. |
| `offline-known-evidence` | “Installed features remain available offline. Checking other mod options needs a connection.” | Continue locally; retry discovery only if requested | Do not downgrade positively validated local evidence because discovery is offline. |

Provider-transition copy must name the **requested feature**, the current and
candidate providers, the reviewed artifact/source policy, configuration
preservation, need to close the game, and rollback behavior before confirmation.
The button is `Review compatible mod option`, not `Enable Battle Bridge` or
`Switch now`.

## Provider-Transition Contract

A provider transition is a feature-remediation path, never passive setup or a
provider-wide upgrade.

```text
explicit feature request
  + installed-runtime resolver says that exact feature is inactive for typed
    missing-capability reason
  + provider discovery locates a possible exact target artifact (lead only)
  + normal artifact pipeline acquires and verifies that exact artifact
  + runtime detector normalizes the target artifact-bound manifest/profile
  + existing LauncherFeatureResolver produces a target activation plan using
    the same checked-in catalog and policy
  + target plan says that exact requested feature is active
  + no recovery or concurrent mutation
    -> offer a reviewable transition preview
    -> player explicitly confirms the exact preview
    -> existing atomic provider-switch coordinator executes
    -> runtime profile and immutable activation plan are recaptured
    -> requested feature is evaluated from the new plan
```

Provider-catalog capabilities, repository ownership, release notes, artifact
names, distribution display names, and source observation can discover a lead;
none can make `transitionOffer=review-available`. The preview must bind the
target provider/channel, exact artifact identity and SHA-256, verified trust
receipt, normalized target runtime profile, target plan policy source, and
requested-feature decision. A changed target artifact invalidates the preview.

The preview is still subject to existing protected TOML backup, selected/
installed provider attribution, game-closed exclusion, operation lock,
rollback, and recovery journal behavior. Staged Settings edits must be saved or
discarded by the player before preview/execute. A transition must not enable
the requested optional feature automatically unless the same confirmation
explicitly includes that preference change and the implementation can commit
both changes transactionally; v1 should prefer a separate post-switch `Enable`
action.

`review-unavailable` has exactly two reason/action shapes:

- `discovery-lead`: an explicit missing-capability request found a possible
  artifact, but exact acquisition/trust/profile/resolver proof has not run.
  Primary action is `Check compatible mod option`; secondary is `Learn more`.
- `temporarily-unavailable`: that bounded check could not complete because of
  a transient network, verified-cache, release-service, or acquisition
  condition. Primary action is `Retry`; secondary is `Learn more`.

`Check` and `Retry` never appear as secondary actions, and `Learn more` never
displaces them as primary. A trust failure, malformed/unsupported target
profile, or exact target decision inactive for the requested feature
disqualifies that lead; it is not a transient error and cannot retain a stale
`review-unavailable` or `review-available` result.

The transition offer is `hidden` when:

- readiness is being checked passively or at startup;
- product policy disabled the feature;
- only a feature dependency is inactive;
- the player simply disabled or paused the feature;
- a custom/unknown DLL cannot be attributed safely;
- another operation or recovery is active; or
- the player only wants to read supported retained history.

## Battle Home Policy And Preference

Battle Home is a presentation preference composed from feature projections,
not a `battle.home` runtime capability or provider-wide feature gate.

This contract does **not** select the minimum Battle Home baseline. #55/#75
must accept explicit checked-in `BattleHomePolicy` metadata before #132 offers
Battle Home. The metadata must contain:

- a stable policy ID/version;
- the exact feature IDs and qualifying collection states, if any;
- the exact workspace IDs and qualifying reader states, if any;
- the exact recovery-owner/state predicates, if any; and
- a deterministic `any`/`all` predicate over those typed facts.

The composer returns `homeOfferability=offerable` only when that accepted
predicate matches the already-composed typed projections. Missing/unaccepted
Home policy returns `not-offerable`; Base Home remains selected. UI labels,
action copy, provider identity, and a provider-transition lead are not inputs
to the predicate. `retained-history-only` can qualify only when the accepted
policy explicitly includes that aggregate summary.

`HomePreference=base` always selects Base Home. `HomePreference=battle`
selects Battle Home only while the accepted predicate returns `offerable`; if
not, Base Home is shown without erasing the stored preference.
`HomePreference=unset` selects Base Home. Whether an offerable state triggers a
one-time “Use Battle Home?” prompt remains the explicit UX decision already
reserved to #55/#75/native review. Base Home and direct navigation remain
available in every case.

## Comprehensive State Matrix

The rows below are planning vectors for #132 tests. “Decision” always means the
already-resolved immutable feature decision; the row does not infer it from the
provider column.

| Case | Focus inputs | Deterministic projection | Actions and Home result |
| --- | --- | --- | --- |
| Wave-one Guffawaffle evidence pin | Installed/selected Guffawaffle is managed/verified at the #25 inventory pins (Bridge `a797254a54a82bfd1fe3f928820fd5290588284c`; mod `b50dc8522a1f289c0ed2e6d86790d0c830be6962`); packaged profile proves only `settings.principal-taxonomy.v1`; Battle decision inactive; no retained data; passive check | Collection `unavailable`; reader `empty`; resolver reason `missing-capability`; Base Bridge healthy | No transition. Home offerability follows accepted Home policy and is otherwise `not-offerable`; Base Home. The historical source observation is not elevated. |
| #241-qualified Guffawaffle artifact | Managed/verified exact artifact publishes whichever Battle contracts #241/#75 accept; its normalized profile and activation plan make only matching decisions active; preference unset; coordinator dormant | Qualified collection `available`; unqualified collection `unavailable`; reader remains independent | `Enable` per qualified feature. Home offerability comes only from accepted Home policy; unset preference keeps Base Home. |
| Wave-one NetniV unknown-evidence baseline | Installed/selected NetniV healthy; #25 inventory records runtime-manifest evidence unknown; Battle decision inactive; passive check | Dependent collection `unavailable`; ordinary Bridge features continue; reader independently reflects retained data | No transition, acquisition, or automatic download. Base Home unless accepted Home policy plus independent reader facts qualify. |
| NetniV unknown, explicit request, discovery lead only | Same installed decision; explicit request for `battle.collection`; provider discovery names a possible target but no exact verified artifact-bound target plan exists | Collection `unavailable`; transition `review-unavailable/discovery-lead` | Primary `Check compatible mod option`; secondary `Learn more`. It cannot offer or execute a provider transition. |
| Transition check temporarily unavailable | Explicit missing-capability request; bounded target check stopped on transient network/release/cache/acquisition condition before exact qualification | Collection result unchanged; transition `review-unavailable/temporarily-unavailable` | Primary `Retry`; secondary `Learn more`. Neither action implies compatibility. |
| Transition lead disqualified | Exact artifact trust fails, target profile is malformed/unsupported, or target resolver decision is inactive | Collection result unchanged; stale transition result removed/`hidden` | Explain no verified compatible option; no `Check`, `Retry`, or `Review` for that disqualified artifact. |
| NetniV unknown, exact target qualified | Same installed decision/request; exact target artifact acquired and trust-verified; detector normalizes target profile; existing resolver target plan makes `battle.collection` active | Installed collection remains `unavailable`; transition becomes `review-available` for that feature and exact artifact only | `Review compatible mod option`; changed hash/profile/policy source invalidates review. Base Home until transition and later opt-in. |
| Future compatible NetniV | Managed/verified exact NetniV artifact has positive normalized evidence; matching installed plan decisions active; preference enabled; coordinator active | Matching collection `active`; unmatched features `unavailable`; reader separate | No provider transition. Explicit Home preference is honored only when accepted Home policy qualifies the projection. |
| Partial NetniV | Exact normalized profile supports Battle capture but not Fleet snapshot; Battle decision active, Fleet decision inactive | Battle collection follows preference/coordinator; Fleet collection `unavailable`; their reader states remain independent | Battle actions remain; Fleet explains typed missing capability. No provider-wide warning or forced switch. |
| Old/partial Guffawaffle | Managed/verified older artifact has an exact normalized subset plan | Same per-feature projection as any partial runtime | A request for a missing feature can produce `review-available` only after another exact verified artifact's target plan activates it. |
| Unknown/custom DLL | Manual/changed/unattributed artifact; no positive normalized evidence; runtime-dependent decision inactive | Collection `unavailable`; supported retained reader may be `readable` | Never attribute, replace, or switch silently. Preserve existing base-health policy and safe retained reads. |
| Managed artifact changed | Selected provider resolved, but installed evidence is `ManagedChanged`, trust no longer matches, or attribution incomplete | Immutable eligibility retained for diagnostics; requested managed mutation `blocked`; reader independent | Existing repair/review path. Do not infer compatibility from selected provider or qualify a transition from unverified source state. |
| Selected/installed provider mismatch | Provider selection and positively attributed installed provider differ outside a reviewed transaction | Eligibility remains the detected runtime decision; requested managed mutation `blocked` | Review installed/selected source. Never silently make either authoritative. |
| Offline with known installed evidence | Managed/verified installed artifact, local normalized profile, and installed plan already captured; discovery unavailable | Existing eligible collection keeps coordinator state; reader unchanged; new transition lead unavailable | Local actions continue. A cached target qualifies only if its exact artifact trust/profile/target-plan receipts are all available and current. |
| Game running, already active | Eligible/opted-in collection `active`; game running; no mutation requested | Collection `active`; reader independent | `Pause`; never warning/“needs attention” solely because game or collector runs. Home follows accepted policy. |
| Start accepted | Eligible/opted-in; no blockers/recovery; coordinator `starting` | Collection `starting` | `Cancel` only if coordinator supports bounded cancellation; otherwise progress/status. It becomes `active` only on coordinator evidence. |
| Stop after capability loss | Coordinator supplies prior-plan stop reference; new plan inactive; coordinator `stopping`; retained data readable | Collection `stopping`; reader `readable`; not yet aggregate `retained-history-only` while stop is in progress | Show stopping progress; after quiescence collection becomes `unavailable` and workspace may summarize retained history only. |
| Impossible active/start state | Coordinator says `starting`/`active`, but decision inactive, consent absent, or required recovery present without a prior stop transaction | Collection `contract-error`; reader independently safe if supported | No mutation. Diagnostics/support action; coordinator owner must reconcile. |
| Game running, mutation requested | Eligible/requested mutation; game running only blocker | Collection `blocked`, primary reason `close-game` | Ask player to close game/check again. Do not terminate it. |
| Concurrent staged edits + restart + game running | Mutation requested; no recovery/operation active; staged edits present, restart required, game running | Collection `blocked`; ordered blockers `save-or-discard-edits`, `restart-required`, `close-game` | Primary `Review changes`; remaining blockers stay visible and are re-evaluated from the next snapshot. |
| Existing operation plus other blockers | Mutation requested; another operation active; staged edits/game-running also present | Collection `blocked`; `operation-in-progress` first, then remaining deterministic order | Primary `View progress`; no competing mutation. |
| Recovery available and blocking | One applicable owner reports `available`, sets mutation-block, and no higher recovery state exists | `recoveryState=available`; collection `recovery-available`; reader stays ordinary unless that owner separately blocks reads | Primary `Review recovery`; no transition qualification until owner resolves/dismisses. |
| Recovery available and non-blocking | One applicable owner reports `available` but permits collection mutation and safe reads | `recoveryState=available`; ordinary collection/reader states continue | Feature operation remains primary; `Review recovery` is secondary. |
| Recovery required plus blockers | One owner `required`; game/staged/restart blockers also present; safe-read effect allowed | Collection `recovery-required`; reader remains `empty`/`readable`; blockers retained diagnostically but suppressed as actions | Primary `Recover`; safe reader navigation remains visible. |
| Concurrent recovery owners | Storage `failed` and blocks reads; provider switch `in-progress`; deployment `required` | Highest normalized collection state `recovery-failed`; owner records retained/sorted; storage reader `recovery-failed` because its owner explicitly blocks reads | `View recovery details` and provider-switch progress remain read-only actions; `Retry` and `Recover` are suppressed while any owner is in progress. No guessed execution order. |
| Failed recovery with safe reads | Applicable storage owner `failed` but safe-read effect allowed; retained schema/data readable | `recoveryState=failed`; collection `recovery-failed`; reader remains `readable` | Primary `View recovery details`, optional safe `Retry` secondary, and independent `Open Battles` read action remains visible. |
| Recovery in progress | Highest applicable owner state `in-progress`; safe-read effect allowed | Collection `recovering`; reader remains ordinary/readable | Status/progress only for recovery, with no recovery action; independently safe read navigation remains visible. |
| Capability loss after update/switch | Preference still enabled; new installed plan makes collection inactive; coordinator quiescent; retained schema readable/data present | Collection `unavailable`; reader `readable`; workspace aggregate `retained-history-only` | `Open Battles`/`Open Fleet Watch`; transition only after explicit request and exact target qualification. Never delete data or clear preference. |
| Player disabled with retained data | Collection decision active/inactive; preference disabled; reader `readable` | Collection `disabled` or `unavailable`; reader `readable`; workspace aggregate may be `retained-history-only` | `Open` and optional `Enable`. Home depends on explicit accepted policy and preference. |
| Retained schema needs migration | Data present; exact schema `migration-required`; collection independent | Reader `migration-required`; collection keeps its own state | `Review upgrade`; never report empty or mutate automatically. Home only if accepted policy includes this typed reader state. |
| Retained schema unsupported/corrupt | Data present; reader evidence `unsupported` or `corrupt` | Reader exact state; collection independent | Safe support export, compatible-version guidance, or `Repair`; no recreation/deletion. |
| Product policy disabled | Decision inactive with typed `policy-disabled`, exact disposition/source; runtime capability may be positive | Collection `unavailable`; reader independent | `Learn more`; never offer provider transition. |
| Player preference unset/disabled | Decision active; no recovery/blocker | Collection `available` when unset, `disabled` when disabled; reader independent | `Enable`; no listener, database creation, or TOML mutation before consent. |
| Independent dependency missing | Decision inactive with typed `dependency-inactive` and dependency IDs | Collection `unavailable`; reader independent | Open dependency when actionable. No transition from the dependent feature. |
| Plan/policy contradiction | Decision lacks typed reason/policy source or claims active while its recorded policy disposition is disabled | Collection `contract-error`; reader independently projected from valid evidence | No mutation or transition; diagnostics expose contract failure without parsing prose. |

The #132 fixture suite should include two vectors with identical activation,
preference, lifecycle, data, blocker, and recovery inputs but different
provider IDs. Their projections must be identical except for provenance and
provider-transition copy. This is the deletion test for accidental provider-
name gating.

## Diagnostics And Automation Contract

Diagnostics should record stable structured fields rather than parse player
copy:

- feature ID, resolver state, typed resolver reason/evidence, and selected
  implementation;
- exact policy disposition plus immutable plan policy source/version;
- player-preference state without secrets;
- collection lifecycle state and last safe transition time;
- retained-data presence, stored-schema version/readability, and bounded counts;
- selected and installed provider/runtime IDs, installation evidence state,
  exact artifact hash where existing diagnostics already permit it, and trust
  result;
- ordered blocker/recovery owner records, selected normalized severity, and
  owning transaction/reference IDs, without configuration, token, raw payload,
  or journal secret contents;
- interaction kind, requested feature ID, transition-offer state, and, for an
  artifact-qualified target, exact target identity/hash, trust result, target
  profile identity, policy source, and requested-feature decision;
- collection state, reader state, aggregate workspace summary, Battle Home
  policy ID/result, and stored Home preference as separate values.

Support export and logs must use stable reason codes and redaction. The local
ingest token, TOML values, raw battle payloads, player/alliance identity, and
provider credentials never enter this projection.

Automation names must describe status and action without relying on color,
icon, or position. Examples:

- `Battle collection, active, collecting while the game is running`;
- `Fleet Watch, unavailable, installed mod does not provide fleet snapshots`;
- `Battles, saved history available, new collection unavailable`;
- `Battles, saved history readable, mod recovery failed`;
- `Review compatible mod option for Battle collection`;
- `Recover incomplete mod provider change`.

Status text belongs on a polite live region only when the state changes from a
player action or completed background check. Continuous Fleet/Battle updates
must not announce each event.

## Implementation Handoff For Bridge #132

The native Bridge implementation should:

1. Add a pure composer that accepts an existing `LauncherActivationPlan` plus
   typed snapshots for preference, collection, storage, provider/install,
   blockers, accepted Battle Home policy, Home preference, recovery, and
   interaction.
2. Extend each activation decision/plan to carry typed eligibility reason and
   evidence, exact policy disposition, and stable checked-in policy
   source/version. The current resolver exposes only prose; the resolver must
   populate these fields beside that prose. The composer cannot receive the
   original override map or parse/infer policy. Do not pass storage,
   preference, game-running, or transaction state into the resolver.
3. Reuse existing provider-selection, `ModInstallationEvidence`, atomic
   provider-switch, operation-lock, configuration edit-session, and recovery
   services. Do not duplicate them in Battle code.
4. Qualify a transition target by verifying the exact artifact, normalizing
   its artifact-bound runtime profile, and running the existing resolver for a
   target plan. Provider catalog metadata remains discovery/trust policy, not
   feature eligibility.
5. Make all state transitions commands with review/confirmation boundaries;
   the composer itself remains side-effect free.
6. Add table-driven tests for every matrix row, provider-neutral twin cases,
   all recovery values crossed with read-allowed/read-blocked effects,
   severity-specific recovery actions, concurrent recovery owners, concurrent
   blocker order, starting/stopping, contract errors,
   discovery-lead/temporarily-unavailable/qualified transition actions,
   passive-versus-explicit target qualification, capability loss with retained
   data, and exact automation/reason categories.
7. Bind both Base and Battle Home to the same health snapshot. Running game and
   active collection states are healthy unless independent evidence says
   otherwise.

No machine-readable fixture is added in this planning repository. A fixture
that recalculates outcomes here would risk becoming a second resolver before
the native types exist. The matrix above is the candidate input/output corpus;
#132 should encode it against the production composer, and #75 should continue
to own immutable capability/producer evidence.

## Decisions Closed And Reserved

Closed by this contract:

- readiness and collection state are per feature, never provider-wide;
- current provider identity is not eligibility;
- retained-data readability is independent of current collection capability;
- provider transitions are explicit feature-remediation reviews only;
- Battle Home is a UI preference, not a runtime capability;
- Base Home is always available and is the safe view for an unset preference;
- passive checks never switch providers or offer an immediate switch;
- player disabling/pausing does not delete data; and
- recovery blocks competing mutation but not safe supported reads.

Reserved for their existing evidence owners:

- exact accepted Battle capability/feature IDs and fixtures: #55/#75/#241;
- exact checked-in feature/workspace predicate that makes Battle Home
  offerable, plus any one-time prompt: #55/#75/native UX review;
- whether collection outlives the visible Bridge process: #59;
- storage budget, compression, migration, and retention defaults: #61/#63/#78;
- actual integrated-package cost and final package naming: #66/#67.
