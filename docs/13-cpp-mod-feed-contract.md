# C++ Mod Ingest And Replay Contract

This contract defines the boundary between the production C++ community mod and the sidecar.

The sidecar must not depend on C++ implementation details. The C++ mod must not depend on sidecar UI internals. The canonical runtime boundary is the local authenticated ingest API, and any JSONL files are optional diagnostics/evidence/replay artifacts rather than the normal runtime path.

The wider architectural boundary is [docs/22-producer-consumer-security-contract.md](22-producer-consumer-security-contract.md): the C++ mod is a best-effort producer and the sidecar is the potentially expensive consumer. This file narrows that contract to the current local ingest payloads and optional replay feed shape.

## Runtime Producer And Consumer

- Producer: STFC Community Mod C++ runtime.
- Runtime consumer: STFC Mod Sidecar local ingest API, event store, fleet broker, viewer, and future local services.
- Canonical runtime contract: authenticated local `POST /api/sidecar/ingest`.
- Durable runtime store: sidecar-owned SQL storage, currently SQLite by default.
- Optional replay/evidence contract: append-only newline-delimited JSON events when explicit local JSONL logging is enabled.

## Canonical Runtime Ingest

Default local endpoint:

```text
http://127.0.0.1:43127/api/sidecar/ingest
```

Rules:

- The mod authenticates with the local sidecar sync token.
- The outer runtime envelope uses `protocolVersion: "stfc.sidecar.ingest.v1"`.
- `kind: "battle.events"` carries arrays of sidecar battle events with `payloadProtocol: "stfc.sidecar.events.v0"`.
- `kind: "fleet.runtime"` carries fleet runtime snapshots with `payloadProtocol: "stfc.fleet.runtime_snapshot.v1"`.
- The sidecar persists accepted runtime payloads in sidecar-owned SQL storage.
- The mod must not write sidecar SQL or SQLite files directly.

## Optional Files

### JSONL Evidence Or Replay Feed

Default Windows path:

```text
C:\Games\Star Trek Fleet Command\default\game\community_patch_battle_feed.jsonl
```

Rules:

- One complete JSON object per line.
- UTF-8 text.
- Append-only during a game session when explicit local JSONL logging is enabled.
- Empty lines may be ignored by consumers.
- Invalid lines must remain visible to diagnostics instead of being silently dropped.
- The file may be absent before the mod emits its first battle event.
- This file is for diagnostics, evidence capture, and replay/import workflows; it is not the canonical runtime boundary.

### Runtime Log

Default Windows path:

```text
C:\Games\Star Trek Fleet Command\default\game\community_patch.log
```

The log is not the structured data contract, but passive live-smoke tooling may use it to verify mod load, config parsing, hook installation, and feed emission status.

## Battle Event Shape

Every individual sidecar battle event inside `battle.events` payloads, and every optional JSONL evidence line, must satisfy the envelope in [docs/02-event-protocol.md](02-event-protocol.md):

- `protocolVersion`
- `type`
- `timestamp`
- optional `sessionId`
- optional `modVersion`
- optional `source`

Events that belong to a versioned payload family must also include `schemaVersion`.

## Current Battle Event Families

The sidecar currently recognizes these battle event families:

- `battle.capture` with `schemaVersion: "stfc.battle.capture.v1"`
- `battle.report` with `schemaVersion: "stfc.sidecar.battle-report.v0"`
- `battle.analytics` with `schemaVersion: "stfc.battle.analytics.v0"`
- `catalog.snapshot` with `schemaVersion: "stfc.catalog.snapshot.v0"`
- transitional `battle.event` lines for simple parsed text events

The canonical battle schema rules live in [docs/08-canonical-battle-schema.md](08-canonical-battle-schema.md).

## Lossless Identifier Rules

The producer must preserve identifiers that can exceed JavaScript's safe integer range as strings.

String required:

- `journalId`
- `battleId`
- raw `capture.battleLog.tokens[]`
- source journal IDs stored under `capture.journal.data`

JSON numbers are acceptable for human-scale counters and metrics such as:

- `battleType`
- `round`
- `tokenCount`
- damage values
- row counts

## Sidecar Consumer Rules

The sidecar must:

- accept canonical runtime ingest through `/api/sidecar/ingest`
- persist accepted runtime payloads in sidecar-owned storage
- parse each optional JSONL line independently during diagnostics or replay/import workflows
- keep invalid/unrecognized lines visible with an error
- ignore unknown additive fields
- avoid assuming every event family exists for every battle
- treat `battle.capture` as the canonical raw battle source when present
- treat `battle.report` as a compatibility bundle
- treat `battle.analytics` as derived and optional
- preserve raw JSON for inspection and diagnostic export

## Producer Rules

The C++ mod should:

- use `/api/sidecar/ingest` as the normal local runtime delivery path
- emit `battle.capture` whenever the raw source battle payload is available
- emit `battle.report` only as a compatibility/convenience bundle
- emit `battle.analytics` only when derived data is reviewable and provenance is included
- emit `catalog.snapshot` when ID-to-label coverage can be described explicitly
- keep unknown or unresolved catalog entries explicit instead of guessing
- prefer additive fields over renames or type changes
- treat sidecar export as optional and best-effort
- bound retries, queues, payload size, and optional JSONL retention
- drop, sample, or defer optional diagnostics rather than blocking gameplay-critical hooks

## Security Boundary

The feed is an observation stream, not an authorization channel.

Never emit:

- bearer tokens
- API keys
- cookies
- Scopely session headers
- provider refresh tokens
- local API capability tokens

If an event needs to refer to a credential context later, use safe metadata such as provider/profile identifiers. The secret value belongs outside the feed.

## Replay Contract

`examples/sample-battle-events.jsonl` is the current replay fixture for this contract.

The core package must be able to parse every non-empty line in that fixture, and the fixture should include at least one representative event for each currently supported battle event family.

Run replay validation with:

```powershell
npm test --workspace @stfc-mod-sidecar/core
```

The replay fixture is intentionally small. Larger real-world captures should be added only after private account, alliance, coordinate, and timing details are reviewed or redacted.

## Change Process

Before changing the C++ feed shape:

1. Update the event protocol or canonical schema docs.
2. Add or update a sample JSONL fixture.
3. Add or update replay validation and any ingest validation that depends on the changed shape.
4. Verify the sidecar viewer still renders the changed event family.
5. Keep old additive fields until consumers no longer need them.
