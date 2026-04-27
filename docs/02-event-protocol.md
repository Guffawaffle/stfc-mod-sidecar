# Event Protocol

V0 uses newline-delimited JSON. Each line is one complete event. JSONL is intentionally plain so the mod can write events without owning a UI process or long-lived socket connection.

## Envelope

Every event should include:

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "debug.event",
  "timestamp": "2026-04-26T00:00:00.000Z",
  "sessionId": "optional-session-id",
  "modVersion": "optional-mod-version",
  "source": "optional-source"
}
```

Required envelope fields:

- `protocolVersion`: currently `stfc.sidecar.events.v0`.
- `type`: one of the event types below.
- `timestamp`: ISO-8601 UTC timestamp from the emitter if available.

Recommended envelope fields:

- `sessionId`: stable identifier for one game/mod run.
- `modVersion`: community mod version or build identifier.
- `source`: module or subsystem that emitted the event.

Security rule:

- Event payloads must not contain bearer tokens, API keys, cookies, Scopely session headers, or other secret values. If an event needs to identify which credential was used, emit only safe metadata such as a provider name or profile reference.

## `debug.event`

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "debug.event",
  "timestamp": "2026-04-26T00:00:01.000Z",
  "sessionId": "sample-session",
  "modVersion": "dev",
  "level": "info",
  "source": "live_debug",
  "message": "Live debug channel disabled by config",
  "context": {
    "configKey": "debug.live_query"
  }
}
```

Fields:

- `level`: `trace`, `debug`, `info`, `warn`, or `error`.
- `source`: module, feature, or hook area.
- `message`: human-readable diagnostic text.
- `context`: optional structured metadata.

## `hook.event`

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "hook.event",
  "timestamp": "2026-04-26T00:00:02.000Z",
  "sessionId": "sample-session",
  "modVersion": "dev",
  "hookName": "ScreenManager.Update",
  "status": "installed",
  "backend": "minhook"
}
```

Fields:

- `hookName`: stable hook identifier.
- `status`: `installed`, `failed`, `disabled`, or `fallback`.
- `backend`: optional hook backend if known.
- `error`: optional error details for failed/fallback states.
- `context`: optional structured metadata.

## `battle.event`

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.event",
  "timestamp": "2026-04-26T00:00:03.000Z",
  "sessionId": "sample-session",
  "battleId": "sample-001",
  "phase": "damage",
  "playerShip": "USS Example",
  "enemy": "Hostile Surveyor",
  "round": 1,
  "damage": {
    "total": 1240,
    "raw": "1,240 damage"
  },
  "rawLine": "Round 1: USS Example dealt 1,240 damage to Hostile Surveyor",
  "parseStatus": "parsed"
}
```

Fields:

- `battleId`: optional battle identifier when present in the source.
- `phase`: `started`, `round`, `damage`, `crit`, `mitigation`, `ended`, or `unknown`.
- `playerShip`: optional player ship text when explicitly known.
- `enemy`: optional enemy text when explicitly known.
- `round`: optional round number when explicitly known.
- `damage`: optional structured damage values.
- `rawLine`: original parsed text line.
- `parseStatus`: `parsed`, `partial`, or `unparsed`.

The parser may emit `phase: "unknown"` with `parseStatus: "unparsed"` to preserve a line without inventing details.

## `battle.capture`

`battle.capture` is the canonical lossless battle payload emitted by STFC Community Mod. It carries raw battle-log tokens as strings so JavaScript consumers do not lose 64-bit precision.

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.capture",
  "schemaVersion": "stfc.battle.capture.v1",
  "timestamp": "2026-04-26T20:54:44",
  "source": "stfc-community-mod",
  "journalId": "2709118446356718841",
  "battleId": "2709118446356718841",
  "battleType": 8,
  "capture": {
    "sourceKind": "scopely.journal.battle",
    "summary": {
      "battleType": 8,
      "targetId": "mar_45",
      "systemId": "2682660367670527124"
    },
    "participants": [],
    "battleLog": {
      "encoding": "string_tokens.v1",
      "tokenCount": 3,
      "tokens": ["-96", "2682660367670527124", "-97"]
    },
    "journal": {
      "encoding": "lossless_integer_strings.v1",
      "omittedKeys": ["battle_log"],
      "data": {
        "id": "2709118446356718841"
      }
    }
  }
}
```

Consumers should treat `capture.battleLog.tokens` as the authoritative raw token stream. `capture.journal.data` preserves the rest of the journal with integer values encoded as strings; `battle_log` is omitted there to avoid duplicating the large token array.

## `battle.report`

`battle.report` is the v0 compatibility bundle emitted by STFC Community Mod for sidecar ingestion.

It is useful for viewers and transitional consumers, but it is not the long-term canonical ingest contract. The layered canonical plan lives in `docs/08-canonical-battle-schema.md`.

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.report",
  "schemaVersion": "stfc.sidecar.battle-report.v0",
  "timestamp": "2026-04-26T20:54:44",
  "source": "stfc-community-mod",
  "journalId": "2709118446356718841",
  "battleId": "2709118446356718841",
  "battleType": 8,
  "report": {
    "summary": {},
    "rewards": [],
    "fleets": [],
    "events": [],
    "rounds": [],
    "attackRows": [],
    "csvParity": {
      "reference": "stfc_client_csv_export",
      "status": "partial",
      "columns": [],
      "rows": [],
      "coverage": {}
    },
    "decode": {},
    "parity": {
      "reference": "stfc_client_csv_export",
      "sections": {
        "battleSummary": "structured",
        "rewards": "structured_ids",
        "fleetStats": "structured_ids",
        "battleEvents": "decoded_segments"
      }
    }
  }
}
```

The first version favors reliable structured IDs over guessed display text. CSV-style battle-event rows began as decoded `battle_log` segments; additive fields such as `rounds` and `attackRows` may appear as higher-order structure is derived.

Consumers should treat `battle.report` as a convenience bundle and ignore unknown additive properties.

Fleet entries may include additive display metadata such as `display_name`, `display_name_source`, `participant_kind`, `ship_level`, and `fleet_type`. Hostile names from the game may arrive as empty or placeholder text such as `Retrieving...`; emitters should preserve raw IDs while using `display_name` for derived, reviewable labels.

## `battle.analytics`

`battle.analytics` carries derived, reviewable battle analysis built from the canonical capture stream. The first implemented slice is a Prime CSV parity table generated from decoded attack records.

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "battle.analytics",
  "schemaVersion": "stfc.battle.analytics.v0",
  "timestamp": "2026-04-26T20:54:44",
  "source": "stfc-community-mod",
  "journalId": "2709118446356718841",
  "battleId": "2709118446356718841",
  "battleType": 8,
  "analytics": {
    "summary": {},
    "rounds": [],
    "attackRows": [],
    "csvParity": {
      "reference": "stfc_client_csv_export",
      "status": "partial",
      "columns": [],
      "rows": [],
      "coverage": {
        "attackRecordCount": 0,
        "csvParityRowCount": 0,
        "abilityRowCount": 0,
        "catalogResolved": false
      }
    },
    "provenance": {
      "ruleVersion": "csv_parity_attack_rows.v1"
    }
  }
}
```

Parity rows use Prime CSV column names in camelCase and keep `sourceKind`, segment/record indexes, ship IDs, component IDs, `confidence`, and `identityStatus` for provenance. Unknown catalog-backed values are emitted as explicit placeholders until the sidecar resolver can map officers, forbidden tech, ship abilities, hull names, resources, and locations.

## `session.event`

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "session.event",
  "timestamp": "2026-04-26T00:00:00.000Z",
  "sessionId": "sample-session",
  "phase": "sidecar_started",
  "metadata": {
    "eventPath": "community_patch_events.jsonl"
  }
}
```

Fields:

- `phase`: `sidecar_started`, `game_detected`, `mod_connected`, `mod_disconnected`, or `session_ended`.
- `metadata`: optional structured session metadata.

## `integration.event`

```json
{
  "protocolVersion": "stfc.sidecar.events.v0",
  "type": "integration.event",
  "timestamp": "2026-04-26T00:00:04.000Z",
  "sessionId": "sample-session",
  "provider": "majel",
  "action": "queue_battle_export",
  "status": "requested",
  "context": {
    "battleId": "sample-001"
  }
}
```

Fields:

- `provider`: `majel`, `spocks`, `stfc_space`, `overwolf`, or `other`.
- `action`: provider-specific action name.
- `status`: `requested`, `succeeded`, `failed`, or `skipped`.
- `context`: optional structured metadata.

## Versioning Notes

V0 should favor additive changes. Avoid renaming fields until real sidecar and mod emitters have both used the protocol enough to expose bad names.

For battle data specifically, treat `protocolVersion` as the transport-envelope version and `schemaVersion` as the payload-family version. Future canonical battle families should version independently from the compatibility bundle.

For security, the event protocol should remain a secret-free observation channel even after future integration credentials exist.
