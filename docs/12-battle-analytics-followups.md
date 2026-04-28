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

## Attack Scalar Investigation

Current decoder state:

- The stable attack payload starts at `attackerShipId, -98, componentId, targetShipId, 1.0, 0.0, 1, criticalFlag`.
- Known damage fields are `hull`, `targetHullRemaining`, `shield`, `targetShieldRemaining`, `mitigated`, and `totalIsolytic`.
- The next two payload slots are currently preserved as `damage.unknownScalarA` and `damage.unknownScalarB`.

Open candidates:

- `mitigatedIsolyticDamage`
- `mitigatedApexBarrier`
- `chargingWeaponsPercent`

Evidence needed to rename either slot:

- A known Prime CSV row for the same battle ID and battle event index, especially the three candidate columns above.
- Or enough controlled captures where one mechanic changes at a time, such as isolytic source on/off, Apex barrier on/off, or charging-weapons behavior on/off.
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
