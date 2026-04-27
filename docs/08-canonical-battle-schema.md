# Canonical Battle Schema

## Goal

The community mod should deliver battle data with as little semantic parsing as possible.

That means the canonical contract must separate three different jobs:

1. Capture raw battle data from the game reliably and losslessly.
2. Add deterministic structure that is cheap to derive and easy to verify.
3. Allow higher-level analytics to evolve without forcing the mod to own that interpretation.

The current `battle.report` event is useful, but it is a compatibility bundle, not the long-term canonical source of truth.

## Separation Contract

The mod owns capture.

The mod may optionally own cheap deterministic decode.

The mod does not need to own analytics semantics such as mitigation naming, weapon mapping, firing pattern labeling, or UI-oriented aggregation.

Any consumer should be able to stop at the lowest layer it trusts:

- raw capture only
- capture plus deterministic decode
- capture plus decode plus analytics

## Versioning Model

There are two independent version axes:

- `protocolVersion`: the transport envelope version for JSONL events.
- `schemaVersion`: the version of one payload family.

Example:

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.capture",
  "schemaVersion": "stfc.battle.capture.v1"
}
```

Rules:

- `protocolVersion` changes only when the shared envelope contract changes.
- `schemaVersion` changes when a specific payload family changes.
- Additive fields do not require a major schema bump.
- Field removal, rename, type change, semantic repurposing, or requiredness change does require a major schema bump.
- Compatibility bundles can evolve additively, but they must not be mistaken for canonical schemas.

## Lossless Value Rules

This is the hard requirement for reliable ingestion.

STFC battle journals contain identifiers larger than JavaScript's safe integer range. A canonical schema must not ship those as JSON numbers when downstream consumers may parse with JavaScript or other IEEE-754 number runtimes.

Canonical rule:

- all identifiers are strings
- all raw battle-log tokens are strings
- computed metrics and human-scale counters may remain JSON numbers

Examples of values that should be strings in the canonical schema:

- `battleId`
- `journalId`
- `shipId`
- `componentId`
- `hullId`
- raw `battleLog.tokens[]`

Examples of values that can remain numbers:

- `battleType`
- `battleDuration`
- `round`
- `shieldDamage`
- `hullDamage`
- `critChance`

## Security Rules

The canonical battle schema is a data contract, not an auth contract.

That means every canonical battle family must remain secret-free.

Never include:

- bearer tokens
- API keys
- cookies
- Scopely session headers
- external provider refresh tokens
- raw authorization headers

If an external action later needs to cite which credential context was used, use safe metadata only, such as:

- `provider`
- `profileId`
- `credentialRef`

The secret itself must stay in sidecar or mod secret storage, outside the canonical battle payload.

## Canonical Families

### 1. `battle.capture`

- `type`: `battle.capture`
- `schemaVersion`: `stfc.battle.capture.v1`
- owner: STFC Community Mod
- stability target: canonical

Purpose:

- preserve the observed source battle payload with minimal transformation
- normalize only the fields required for correlation and safe ingestion
- avoid semantic guesses

Required shape:

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.capture",
  "schemaVersion": "stfc.battle.capture.v1",
  "timestamp": "2026-04-26T20:54:44Z",
  "source": "stfc-community-mod",
  "sessionId": "optional-session-id",
  "journalId": "2709118446356718841",
  "battleId": "2709118446356718841",
  "capture": {
    "sourceKind": "scopely.journal.battle",
    "capturedAtUnixMs": 1745691284000,
    "summary": {
      "battleType": 8,
      "battleTime": "2026-04-26T20:54:44",
      "battleDuration": 5,
      "initiatorId": "u5a34863cf704323a10f6116a430295d",
      "targetId": "mar_55999c7a_45",
      "initiatorWins": true,
      "systemId": "647359475"
    },
    "participants": [
      {
        "uid": "u5a34863cf704323a10f6116a430295d",
        "side": "initiator",
        "shipIds": ["2682660367670527124"],
        "hullIds": ["711428193"],
        "componentIds": ["2554566705"]
      }
    ],
    "battleLog": {
      "encoding": "string_tokens.v1",
      "tokenCount": 4,
      "tokens": ["-96", "-90", "-88", "2682660367670527124"]
    },
    "names": {
      "u5a34863cf704323a10f6116a430295d": {
        "name": "Guffawaffle"
      }
    },
    "journal": {
      "encoding": "lossless_integer_strings.v1",
      "omittedKeys": ["battle_log"],
      "data": {}
    }
  }
}
```

Rules:

- `capture.battleLog.tokens` is the authoritative raw battle-log token stream.
- `capture.journal.data` preserves the source journal object outside `battle_log`, with integer values encoded as strings.
- `capture.journal.omittedKeys` declares source keys intentionally carried elsewhere to avoid duplication.
- `capture.summary` is a normalized extraction of cheap, high-value correlation fields.
- `capture.participants` is a normalized ID index only.
- `display_name` is not required here.
- any display text included here must be additive and marked as derived.

### 2. `battle.decode`

- `type`: `battle.decode`
- `schemaVersion`: `stfc.battle.decode.v1`
- owner: any deterministic decoder, including the mod if it is cheap enough
- stability target: canonical

Purpose:

- add structural boundaries and references without inventing unstable semantics
- make token streams queryable without forcing every consumer to rediscover segment and record boundaries

Required shape:

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.decode",
  "schemaVersion": "stfc.battle.decode.v1",
  "timestamp": "2026-04-26T20:54:44Z",
  "source": "stfc-community-mod",
  "journalId": "2709118446356718841",
  "battleId": "2709118446356718841",
  "captureSchemaVersion": "stfc.battle.capture.v1",
  "decode": {
    "signature": {},
    "markerHints": {},
    "segments": [],
    "records": []
  }
}
```

Rules:

- `battle.decode` may depend on `battle.capture`, but it must remain deterministic.
- field names should describe structure, not guessed gameplay meaning.
- examples: `segmentIndex`, `recordIndex`, `payloadStart`, `shipRefs`, `componentRefs`, `markers`.
- avoid names like `weaponName`, `mitigationBucket`, or `subRoundType` unless that meaning is proven stable.

### 3. `battle.analytics`

- `type`: `battle.analytics`
- `schemaVersion`: `stfc.battle.analytics.v0`
- owner: sidecar or another downstream tool
- stability target: explicitly derived and change-prone until promoted

Purpose:

- express higher-order semantics such as rounds, sub-rounds, attack rows, mitigation, crit summaries, firing patterns, and weapon grouping
- evolve independently of raw capture and deterministic decode

Required shape:

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.analytics",
  "schemaVersion": "stfc.battle.analytics.v0",
  "timestamp": "2026-04-26T20:54:44Z",
  "source": "stfc-sidecar",
  "journalId": "2709118446356718841",
  "battleId": "2709118446356718841",
  "captureSchemaVersion": "stfc.battle.capture.v1",
  "decodeSchemaVersion": "stfc.battle.decode.v1",
  "analytics": {
    "rounds": [],
    "attackRows": [],
    "provenance": {
      "confidence": "mixed",
      "notes": []
    }
  }
}
```

Rules:

- analytics fields are allowed to be provisional, but that status must be explicit.
- any promoted semantic field should cite the decode inputs it came from.
- downstream tools should treat this family as optional.

### 4. `battle.report`

- `type`: `battle.report`
- `schemaVersion`: `stfc.sidecar.battle-report.v0`
- owner: compatibility bundle producer
- stability target: convenience only

Purpose:

- provide one easy event for viewers, debugging, and transitional consumers
- bundle summary, rewards, fleets, decode output, and optional analytics in one place

Rules:

- not canonical
- not the only long-term ingest path
- allowed to carry additive convenience fields such as `rounds` and `attackRows`
- should embed parity/provenance so consumers know what is structured vs derived

## Shared Correlation Fields

Every battle family should share these top-level fields:

- `journalId`
- `battleId`
- `timestamp`
- `sessionId` when known
- `source`
- `schemaVersion`

Optional but recommended:

- `capturedAtUnixMs`
- `modVersion`
- `producer` object later if the envelope grows past v0

## Display Text Rules

Display text is never a substitute for IDs.

If present, display-oriented fields must be additive:

- `displayName`
- `displayNameSource`
- `participantKind`

Required rule:

- every display field must be backed by an ID field in the same object or a referenced object

## Rollout Plan

### Phase 1

- keep `battle.report` v0 for compatibility
- define this layered contract as the source of truth
- mark `battle.report` as transitional in docs and types

### Phase 2

- emit `battle.capture` from the mod
- optionally emit `battle.decode` from the mod when cheap
- keep `battle.report` as a bundle built from those canonical events

### Phase 3

- move round/sub-round/per-attack semantics into `battle.analytics`
- let sidecar and third parties iterate there without destabilizing capture/decode

### Phase 4

- once consumers rely on canonical families, freeze `battle.report` or demote it to a viewer convenience product

## Decision Summary

The canonical contract should be layered as:

- `battle.capture` for lossless, minimally interpreted mod output
- `battle.decode` for deterministic structure
- `battle.analytics` for optional semantics
- `battle.report` as a compatibility bundle only

That separation keeps the mod focused on efficient data delivery while giving downstream tools a stable place to build richer interpretation.