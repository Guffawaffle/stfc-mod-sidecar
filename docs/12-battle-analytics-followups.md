# Battle Analytics Follow-Ups

This note tracks post-parity battle analytics work that should be revisited after the Prime CSV parity path and catalog snapshot contract stay stable across more live captures.

## Analytics Capture Review

Goal: use the captured `battle.capture`, `catalog.snapshot`, `battle.report`, and `battle.analytics` events to decide which additional fields are worth promoting into the supported sidecar contract.

Ground rules:

- Keep raw IDs and provenance for every derived field.
- Promote a field only when it has a stable source, stable semantics, and a practical viewer or export use.
- Keep candidate fields out of user-facing parity columns until they match known Prime output or confirmed marker semantics.
- Prefer additive sidecar fields over changing existing event shape.

Initial candidate areas:

- Attack scalar slots after `totalIsolytic`.
- Ability, buff, debuff, forbidden-tech, and triggered-effect rows.
- Component and weapon-roll summaries by round/subround.
- Battle-level outcome summaries that can be reproduced from attack rows.
- Catalog resolution coverage and unresolved-domain reporting.

## Runtime Effect Catalog Bridge

Native runtime ability/effect resolver probing must stay scan-only unless a future implementation uses a main-thread-safe cached snapshot. The combat-log worker must not call live `CatalogResolver`, IL2CPP, `SpecManager`, or `ActivatedAbilityManager` surfaces to resolve candidate refs.

The sidecar bridge is the safe path for this slice. When a `battle.analytics` event and the matching `catalog.snapshot` share a `battleId` or `journalId`, the battle detail API derives a compact runtime effect overlay from static catalog fields only:

- `analytics.experimental.runtimeAbilityRowCandidates[*].sourceRef` and `effectRef` remain exact strings.
- Officer matches are structural field joins against `belowDecksAbilityId`, `officerAbilityId`, and `captainManeuverId`.
- Hull self-matches are classified as `hull_or_ship_effect` and are not promoted into officer matches.
- Unmatched candidates remain present with `confidence: "unresolved"` and their refs reported in coverage metadata.
- The overlay does not promote candidates into Prime CSV parity ability rows.

These structural joins are not final ability activations, proc math, opportunity counts, stacking, refresh, or expiry semantics. They are enough to make refs explainable once existing catalog/static data can provide names or localization text.

### Optional Local Name Snapshot

For Workbench readability, the sidecar may optionally hydrate officer and runtime effect names from a local snapshot directory configured with `STFC_LOCAL_NAME_SNAPSHOT_DIR`. The older `STFC_SIDECAR_RUNTIME_NAME_SNAPSHOT_ROOT` name remains a compatibility alias for local development.

Rules:

- this snapshot seam is sidecar-only and must not change canonical stored events
- the view layer must continue to work without it by falling back to `catalog.snapshot` names when present, otherwise exact refs
- hydrated output should expose where each name came from, not hide the distinction between `catalog.snapshot`, `local_snapshot`, and fallback refs
- external catalogs may label the same IDs differently, so source provenance must stay visible

Current audited coverage in the copied local snapshot is narrow:

- present and wired: `officer/summary.json`, `translations/en/officer_names.json`, `translations/en/officer_buffs.json`
- not yet present in the copied snapshot seam or not yet wired: forbidden tech, chaos tech, general buff/debuff catalogs

That means officer-name and officer-ability hydration is ready for screenshot-grade display, but FT/CT naming remains an audit gap until a stable source format is confirmed.

Local dev check:

```powershell
$env:STFC_SIDECAR_PORT = "43129"
$env:STFC_SIDECAR_STORE_CONNECTION = "C:\Users\Guff\AppData\Roaming\STFC Community Mod Companion\sidecar-events.sqlite"
$env:STFC_LOCAL_NAME_SNAPSHOT_DIR = "D:\dev\stfc-local-name-snapshot"
npm run viewer:run -- --game-dir "C:\Games\Star Trek Fleet Command\default\game" --developer-mode --port 43129
```

This is a developer-only launch seam. `D:\dev\stfc-local-name-snapshot` must not become a packaged default, and new crawl or import work remains deferred until that source is stable.

## Attack Scalar Investigation

Current decoder state:

- The stable attack payload starts at `attackerShipId, -98, componentId, targetShipId, 1.0, 0.0, 1, criticalFlag`.
- Known damage fields are `hull`, `targetHullRemaining`, `shield`, `targetShieldRemaining`, `mitigated`, and `totalIsolytic`.
- The next two payload slots are preserved in stored/raw analytics for compatibility, but sidecar human views now project them as native-style mitigation fields:
  - `damage.unknownScalarA` -> `mitigatedIsolyticDamage`
  - `damage.unknownScalarB` -> `mitigatedApexBarrier`

Open candidates:

- `chargingWeaponsPercent`

Evidence supporting the mitigation projection:

- A current JSON/native screenshot pair showed `damage.unknownScalarA: 482477.80000000005` rendered natively as `Mitigates 482,477 Isolytic damage`.
- The same pair showed `damage.unknownScalarB: 16528.6` rendered natively as `Mitigates 16,528 using Apex Barrier`.

Evidence still needed for additional slot promotion:

- A known Prime CSV row for the same battle ID and battle event index, especially `Charging Weapons %`.
- Or enough controlled captures where one mechanic changes at a time, such as charging-weapons behavior on/off.
- Exact battle IDs are more useful than screenshots alone because the JSONL line can be joined back to source segment and record indexes.

Repeatable analysis:

```bash
npm run analyze:attack-scalars -- /mnt/c/Games/'Star Trek Fleet Command'/default/game/community_patch_battle_feed.jsonl
```

The script reports corpus counts, combat-flow groupings, component groupings, scalar ratios, and component names when catalog snapshots include them. Its output is evidence for hypotheses, not field-label authority.

## Viewer Scale Note

The viewer should not keep full parsed battle payloads for every listed JSONL line once the feed grows. The preferred shape is:

- Load a lightweight event index for the recent line window.
- Keep an append-aware server-side feed index so summary reads reuse prior work instead of rereading the whole JSONL file.
- Store byte offsets for indexed lines so selected details can be rehydrated on demand.
- Fetch full event details only when the user selects a battle or event.
- Keep raw JSON and heavy derived tables out of the initial page payload.
- Preserve the current local-only, read-only API boundary.

The index/detail split and append-aware feed index are both in place. The remaining scale step is a true ingest pipeline that tails the feed once, queues heavy derivation work, and keeps a bounded store with a pressure valve for evicting expensive derived state before raw offsets.
