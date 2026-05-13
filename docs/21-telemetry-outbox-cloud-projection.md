# Telemetry Outbox And Cloud Projection

Status: accepted architecture; experimental bridge slice in progress
Date: 2026-05-11

## Decision

Commander's proposed shape is confirmed by the current workspace, with one correction:

- Confirmed: the mod has asynchronous upload workers, but the queue in `mods/src/patches/parts/sync.cc` is memory-backed and failed posts are logged rather than retried durably.
- Confirmed: the sidecar already has a SQLite/PostgreSQL event-store abstraction with SQLite WAL and dedupe in `packages/core/src/storage/sql-event-store.ts`.
- Confirmed: existing sidecar docs already point toward bounded ingest, local SQL storage, and a pressure valve.
- Confirmed: Majel has a one-way append endpoint and PostgreSQL event store.
- Correction: Majel's current sidecar ingest accepts the broader sidecar event protocol, including raw battle capture classes. The generic route remains broader sidecar ingest for now and is not suitable for cloud projection ingestion. A separate strict `POST /api/sidecar/telemetry` route is the only allowed cloud projection ingest path. Future work may deprecate or narrow the generic route after caller inventory.

The architecture is a local telemetry outbox plus cloud projection. It is not realtime cloud sync from the mod.

```text
game hooks
  -> tiny read-only observation enqueue
  -> local headless sidecar broker
  -> local durable store + projection + outbound queue
  -> batched cloud-safe upload
  -> Majel append + fleet projection tables
  -> cheap consumer read APIs
```

## Principles

- This is a telemetry fabric, not a cheat layer.
- This is a projection architecture, not realtime cloud sync.
- This is privacy-bounded, not privacy-guaranteed.
- This is durability and observability, not automation.
- No gameplay mutation, gameplay automation, client-side optimization, reward-path change, cooldown bypass, cost bypass, or resource-spend reduction belongs in this design.
- No LLM or AI model call belongs in ingest, upload, projection, or polling.
- Local-only mode must remain useful.
- Cloud upload must be obvious to disable.

Important architecture constraint:

The sidecar may provide the most reliable path for durable local outbox, cloud upload, retries, coalescing, and projection support, but sync improvements must not become intrinsically sidecar-only.

Existing consumers should be able to benefit from improved event contracts, safer schemas, better dedupe/idempotency, clearer projection APIs, and lower-cost sync behavior where appropriate.

The sidecar is an implementation path and reliability layer, not the sole conceptual owner of sync.

Do not design the system so that:

- existing consumers are forced through the sidecar unnecessarily
- cloud-safe schemas only make sense for the sidecar
- projection APIs only serve sidecar-originated data
- improvements to sync durability make current consumers worse
- the old sync path is broken before migration is planned
- consumers must subscribe to raw sidecar internals

Preferred framing:

- shared event contracts
- strict cloud-safe schemas
- sidecar as durable broker/uploader
- Majel as projection/materialization boundary
- existing consumers migrate gradually or opt into improved contracts
- local-only and non-sidecar consumers remain viable where technically reasonable

Majel is the first-class supported cloud projection consumer for this implementation phase, but Majel is not the owner of the generic sync contract. New advanced features may be Majel-first, and existing consumers do not need to receive every new capability immediately, but shared schemas and contracts should not become Majel-only unless a clear reason is documented.

Sidecar implementation details must remain private implementation details. Future consumers should be able to use stable Majel projection APIs or the shared cloud-safe event contract without depending on sidecar SQLite tables, sidecar internal queue formats, raw sidecar event streams, UI-specific sidecar behavior, or broker implementation details.

Existing consumers may be left out of new feature work, but they must not be regressed or forced through sidecar internals. Any migration away from existing sync consumers must be explicit, documented, and separately accepted. Do not retrofit every existing consumer into the new telemetry system during this slice.

## Dependency Order

Cross-repo tracker: https://github.com/Guffawaffle/stfc-mod-sidecar/issues/32

Implementation must proceed in this order:

1. Phase 0: strict Majel telemetry boundary - done in the schema-first slice.
   - Majel issue: https://github.com/Guffawaffle/majel/issues/292
2. Phase 1: Majel append table + idempotency.
   - Majel issue: https://github.com/Guffawaffle/majel/issues/290
3. Phase 2: sidecar local durable outbox, no cloud upload yet.
   - Sidecar issues: https://github.com/Guffawaffle/stfc-mod-sidecar/issues/35, https://github.com/Guffawaffle/stfc-mod-sidecar/issues/33, https://github.com/Guffawaffle/stfc-mod-sidecar/issues/36, https://github.com/Guffawaffle/stfc-mod-sidecar/issues/34
4. Phase 3: sidecar uploader to strict Majel telemetry route.
   - Sidecar issue: https://github.com/Guffawaffle/stfc-mod-sidecar/issues/37
5. Phase 4: Majel projection tables and cheap read API.
   - Majel issues: https://github.com/Guffawaffle/majel/issues/293, https://github.com/Guffawaffle/majel/issues/291
6. Phase 5: mod producer handoff to sidecar broker.
   - Mod issues: https://github.com/netniV/stfc-mod/issues/176, https://github.com/netniV/stfc-mod/issues/175
7. Phase 6: profiling and optimization, including named pipe evaluation only if justified.
   - Mod issue: https://github.com/netniV/stfc-mod/issues/174

The current sidecar bridge slice is intentionally smaller than this full architecture: it exposes a token-gated, memory-backed `/api/fleet/sync` adapter for advanced testing of the strict Majel telemetry boundary. Durable local outbox, restart-safe retry, projection tables, and broader mod handoff remain gated by the dependency order below.

Next implementation slice: Phase 1 Majel append persistence and idempotency, followed by the durable sidecar outbox before any durable cloud-upload claim.

## Current Evidence

| Area | Current evidence | Architecture impact |
| --- | --- | --- |
| Mod sync | `TargetWorker` drains `std::queue` and synchronously posts on a worker thread. The gameplay thread does not wait on the HTTP post, but the queue is not durable. | Reuse the async boundary and delta knowledge, but do not use this as the cloud durability layer. |
| Sidecar local store | `createSqlSidecarEventStore()` supports SQLite and PostgreSQL; SQLite uses WAL and event-key dedupe. | Extend this pattern for raw log, outbound queue, and projection tables. |
| Sidecar integration docs | The preferred path is local HTTP plus SQL storage; JSONL remains an explicit fallback. | Keep localhost HTTP first; only evaluate named pipes after profiling shows heat. |
| Majel ingest | `POST /api/sidecar/events` is token-gated, rate-limited, POST-only, and append-only. | Reuse auth/rate-limit shape for a separate strict `POST /api/sidecar/telemetry` route. Do not broadly harden the generic route before caller inventory. |
| Majel store | `sidecar_ingest_events` appends canonical sidecar events with dedupe. | Add projection tables and cheap consumer reads; consumers should not read raw event streams. |

## A. Mod Observation Layer

The mod remains a read-only observer. The hook/detour path may collect compact facts that already exist in memory, but it must not perform durable storage, cloud auth, AI calls, slow serialization, or network waits.

Implementation rules:

- Hook bodies may only enqueue a compact observation into an in-process bounded ring buffer or existing async exporter.
- Observation enqueue must be nonblocking and have a fixed upper bound.
- If the ring buffer is full, drop the newest low-priority observation or coalesce into an existing pending observation. Never block the game thread.
- The hook path must not build large JSON payloads. If JSON is needed, serialize on the worker/broker side.
- The hook path must not call SQLite, write JSONL, call localhost HTTP directly, wait for cloud upload, or run expensive diffs.
- Reuse existing extraction and delta-detection only where the read cost is already known and local. Do not reuse heavy current sync payloads as the cloud contract.
- Existing local JSONL/debug capture remains explicit local fallback only.

Initial mod output should be small observations such as:

- fleet slot identity changed
- fleet state changed
- session state changed
- battle summary available
- periodic compact fleet snapshot requested by the async worker

Overload behavior:

- Maintain counters for `telemetry.enqueue.count`, `telemetry.enqueue.dropped`, and `telemetry.ring.depth`.
- Classify observations by priority: `session` > `fleet.state` > `fleet.slot` > `battle.summary` > diagnostics.
- Drop or coalesce lower-priority items first.
- Emit a local-only diagnostic when drops happen, but rate-limit that diagnostic.

## B. Headless Sidecar Broker

The sidecar broker is the ingestion backbone. The UI can observe it, but the UI is not required for ingest, durability, upload, or projection.

Responsibilities:

- Own localhost ingest from the mod.
- Own local durable event storage.
- Own the current local fleet projection.
- Own cloud-safe classification and redaction.
- Own the outbound queue.
- Own upload retry, jitter, exponential backoff, coalescing, trimming, and dedupe.
- Expose local status and diagnostics to the UI.
- Continue to work with cloud upload disabled.

Transport:

- Start with localhost HTTP using the existing sync-token pattern and body limits.
- Keep JSONL as explicit local fallback and replay/debug surface.
- Do not build a named-pipe replacement until localhost HTTP enqueue and broker ingest are profiled and shown to be measurable game heat.

Uploader defaults:

- Batch cadence: 250-1000 ms with jitter.
- Batch size: start at 50 events or 128 KiB, whichever comes first.
- Retry: exponential backoff with jitter, honoring 429/503 and network failures.
- Circuit break: after repeated failures, pause upload and keep local projection useful.
- Coalesce before upload: only the latest superseding fleet slot/state event per entity should remain pending unless an event is audit-critical.
- User-visible disable: one switch for cloud upload; local ingest and local projection remain enabled.

## C. Local Storage

Use the current `sql-event-store.ts` style and add a broker store module instead of mixing outbound state into the existing raw event store. SQLite remains the default local backend. PostgreSQL compatibility can follow the existing dialect pattern.

### `sidecar_events` - bounded raw event log

Purpose:

- Preserve local canonical events for replay, diagnostics, and local-only workflows.
- Store raw sidecar events that may include local-only or high-risk data.

Key columns:

- `sequence_id INTEGER PRIMARY KEY AUTOINCREMENT`
- `event_key TEXT NOT NULL UNIQUE`
- `protocol_version TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `classification TEXT NOT NULL CHECK classification IN ('local_only','cloud_private','shareable')`
- `schema_version TEXT`
- `event_timestamp TEXT NOT NULL`
- `session_id TEXT`
- `source TEXT`
- `entity_key TEXT`
- `payload_json TEXT NOT NULL`
- `ingested_at TEXT NOT NULL DEFAULT now`

Indexes:

- `(event_timestamp DESC)`
- `(event_type, event_timestamp DESC)`
- `(classification, event_timestamp DESC)`
- `(session_id, event_timestamp DESC)`
- `(entity_key)`

Dedupe and idempotency:

- Continue using stable `event_key` derivation for immutable observations.
- For superseding observations, derive `event_key` from type, version, session, entity, and observation version or timestamp bucket.

Retention and trimming:

- Bound by size and age. Start with 100 MiB or 7 days, configurable.
- Trim oldest local-only/debug events first when pressure rises.
- Preserve raw offsets for JSONL replay if JSONL fallback is active.

Crash recovery:

- SQLite WAL handles committed writes.
- On restart, rebuild broker counters from table state and resume from outbound queue.

Migration impact:

- This extends the current `sidecar_events` shape with classification/entity fields, or creates `sidecar_raw_events` if a less disruptive migration is safer.

### `sidecar_outbox` - outbound queue of cloud-safe items

Purpose:

- Hold only cloud-eligible, redacted, allowlisted events ready for Majel.
- Decouple local ingest from cloud availability and cloud cost.

Key columns:

- `outbox_id INTEGER PRIMARY KEY AUTOINCREMENT`
- `idempotency_key TEXT NOT NULL UNIQUE`
- `event_type TEXT NOT NULL`
- `schema_version TEXT NOT NULL`
- `classification TEXT NOT NULL CHECK classification IN ('cloud_private','shareable')`
- `entity_key TEXT`
- `coalesce_key TEXT`
- `payload_json TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `not_before_at TEXT NOT NULL`
- `attempt_count INTEGER NOT NULL DEFAULT 0`
- `last_attempt_at TEXT`
- `last_error TEXT`
- `status TEXT NOT NULL CHECK status IN ('pending','in_flight','sent','dead')`
- `sent_at TEXT`

Indexes:

- `(status, not_before_at, outbox_id)`
- `(coalesce_key, status)`
- `(event_type, created_at DESC)`

Dedupe and idempotency:

- `idempotency_key` must be stable across retry and restart.
- Use `ON CONFLICT(idempotency_key) DO UPDATE` only for superseding event types.
- Use `coalesce_key` for latest-state semantics, such as one pending fleet state per fleet slot.

Retention and trimming:

- Keep sent rows briefly, for example 24 hours or 10,000 rows, for diagnostics.
- Dead-letter rows after max attempts or forbidden-schema rejection.
- Under storage pressure, drop low-priority pending superseded rows before fresh high-priority rows.

Crash recovery:

- On broker startup, reset stale `in_flight` rows to `pending` if `last_attempt_at` is older than a short timeout.
- Never delete a row until Majel returns accepted or duplicate for its idempotency key.

Migration impact:

- New table. It should not alter existing viewer detail behavior.

### `sidecar_fleet_projection` - current local fleet projection

Purpose:

- Maintain the local current state that the UI and uploader can read cheaply.
- Provide local-only value even with cloud disabled.

Key columns:

- `projection_key TEXT PRIMARY KEY`
- `projection_type TEXT NOT NULL` such as `fleet`, `slot`, `session`, `battle_summary`
- `entity_key TEXT NOT NULL`
- `state_version INTEGER NOT NULL`
- `classification TEXT NOT NULL`
- `state_json TEXT NOT NULL`
- `source_event_key TEXT`
- `updated_at TEXT NOT NULL`

Indexes:

- `(projection_type, updated_at DESC)`
- `(entity_key)`
- `(state_version)`

Dedupe and idempotency:

- Upsert by `projection_key`.
- Only apply updates that advance `state_version` or have a newer source timestamp with the same version semantics.

Retention and trimming:

- Keep current projection indefinitely while user keeps local data.
- Keep bounded projection history in a separate optional history table only if needed.

Crash recovery:

- Projection survives restart.
- If projection is corrupt or migration changes shape, rebuild from `sidecar_events` within retention window.

Migration impact:

- New table. Existing event viewer can stay on the raw event log while new status views read projection.

## D. Cloud-Safe Event Contract

Use a separate cloud telemetry protocol version, for example `stfc.telemetry.v1`, so cloud-safe upload is not confused with the broader local sidecar event protocol.

Common envelope:

```json
{
  "protocolVersion": "stfc.telemetry.v1",
  "schemaVersion": "stfc.telemetry.fleet-state.v1",
  "type": "fleet.state.changed",
  "timestamp": "2026-05-11T00:00:00.000Z",
  "sessionId": "local-session-id",
  "installId": "opaque-install-id",
  "source": "stfc-sidecar",
  "classification": "cloud_private",
  "idempotencyKey": "stable-key"
}
```

Global forbidden fields:

- Auth headers, cookies, Scopely session IDs, API keys, access tokens, refresh tokens, bearer tokens, and sync tokens.
- Raw coordinates, exact private locations, and raw system-position observations by default.
- Raw battle logs, raw battle token streams, raw protocol payloads, and private Scopely/internal material.
- Chat messages, private alliance/player messages, or sensitive logs.
- Arbitrary nested `raw`, `headers`, `request`, `response`, `cookie`, `token`, `sessionHeader`, or `authorization` fields.

Majel must reject unknown event types and unknown high-risk field names by default.

### Event types

| Event | Classification | Version | Uploaded by default | Expected frequency | Coalescing |
| --- | --- | --- | --- | --- | --- |
| `fleet.snapshot` | `cloud_private` | `stfc.telemetry.fleet-snapshot.v1` | Yes, after explicit cloud enable | On session start and every 30-120 seconds while active | Supersede older pending snapshot per install/session |
| `fleet.slot.changed` | `cloud_private` | `stfc.telemetry.fleet-slot-changed.v1` | Yes | Low to moderate; only on observed slot change | Latest pending per slot |
| `fleet.state.changed` | `cloud_private` | `stfc.telemetry.fleet-state-changed.v1` | Yes | Low to moderate; only state transitions | Latest pending per fleet/slot/state |
| `battle.summary` | `cloud_private` or `shareable` after explicit review | `stfc.telemetry.battle-summary.v1` | Yes as private summary; shareable only by explicit user action | On completed battle summary | No coalescing; dedupe by battle summary key |
| `session.state` | `cloud_private` | `stfc.telemetry.session-state.v1` | Yes | Start/stop/connect/disconnect/cloud-disabled | Keep ordered lifecycle events |

### `fleet.snapshot`

Allowed fields:

- `installId`, `sessionId`, `snapshotId`, `snapshotVersion`, `observedAt`, `modVersion`, `sidecarVersion`
- `fleetCount`
- `slots`: array of compact slot records: `slotKey`, `fleetKey`, `shipKeyHash`, `shipType`, `levelBand`, `state`, `assignmentKind`, `healthBand`, `cargoBand`, `updatedAt`
- `capabilities`: optional safe feature flags such as `battleSummary`, `fleetProjection`

Forbidden fields:

- Exact coordinates, exact cargo quantities by default, raw ship names if user chooses privacy mode, raw player/alliance identifiers unless hashed/salted locally, raw game payloads.

Dedupe and idempotency:

- `idempotencyKey = installId + ':fleet.snapshot:' + snapshotId`
- `coalesceKey = installId + ':fleet.snapshot:' + sessionId`

Retention:

- Majel keeps latest projection and short snapshot history, for example 24-72 hours unless the user opts into longer retention.

### `fleet.slot.changed`

Allowed fields:

- `installId`, `sessionId`, `slotKey`, `fleetKey`, `previousState`, `currentState`, `assignmentKind`, `observedAt`, `stateVersion`

Forbidden fields:

- Exact coordinates, raw target IDs, raw route details, resource spend/cost internals, private protocol payloads.

Dedupe and idempotency:

- `idempotencyKey = installId + ':fleet.slot.changed:' + slotKey + ':' + stateVersion`
- `coalesceKey = installId + ':fleet.slot:' + slotKey`

Retention:

- Keep bounded recent deltas, for example 24 hours or last 500 per install.

### `fleet.state.changed`

Allowed fields:

- `installId`, `sessionId`, `fleetKey`, `slotKey`, `previousState`, `currentState`, `observedAt`, `stateVersion`, `reasonCode` from a fixed enum.

Forbidden fields:

- Private location, raw target entity, raw hostile/player/alliance IDs, raw payloads, raw server event bodies.

Dedupe and idempotency:

- `idempotencyKey = installId + ':fleet.state.changed:' + fleetKey + ':' + stateVersion`
- `coalesceKey = installId + ':fleet.state:' + fleetKey`

Retention:

- Latest state in projection; bounded recent deltas only.

### `battle.summary`

Allowed fields:

- `installId`, `sessionId`, `battleKey`, `battleKind`, `result`, `startedAt`, `endedAt`, `durationBand`, `playerFleetKey`, `opponentKind`, `powerBand`, `rewardBand`, `lossBand`, `parserVersion`, `confidence`

Forbidden fields:

- Raw battle token stream, raw journal payload, exact coordinates, exact private player/alliance IDs unless locally hashed and explicitly allowed, chat, cookies, auth headers.

Dedupe and idempotency:

- `idempotencyKey = installId + ':battle.summary:' + battleKey`
- No coalescing except duplicate replacement with identical key.

Retention:

- Projection summary history can be longer than fleet deltas, but default should remain bounded and user-controlled.

### `session.state`

Allowed fields:

- `installId`, `sessionId`, `phase`, `observedAt`, `modVersion`, `sidecarVersion`, `cloudUploadEnabled`, `reasonCode`

Forbidden fields:

- Local file paths unless redacted, machine username, environment dumps, tokens, headers, stack traces with payload data.

Dedupe and idempotency:

- `idempotencyKey = installId + ':session.state:' + sessionId + ':' + phase + ':' + observedAt`
- No coalescing for lifecycle transitions.

Retention:

- Keep bounded session summaries and current active-session state.

## E. Majel Ingest And Projection

Majel should ingest cloud-safe telemetry only for this path. It should append accepted events cheaply, then materialize projections for consumers. Consumers should never need the raw stream.

Recommended endpoint:

- `POST /api/sidecar/telemetry`
- Auth: service token or scoped device token in an authorization header. Do not document real token values.
- Body limit: start at 256 KiB to 1 MiB, not 5 MiB, because this endpoint should only accept compact telemetry.
- Request body: `{ "batchId": "...", "sentAt": "...", "events": [ ... ] }`
- Response: `{ "accepted": n, "duplicates": n, "rejected": [{ "index": n, "code": "..." }] }`
- Unknown event types: reject.
- Unknown high-risk fields: reject.
- Unknown harmless additive fields: reject until explicitly added to the allowlist.

The existing `POST /api/sidecar/events` route remains broader sidecar ingest for current raw/canonical sidecar experiments. It is explicitly not the cloud projection ingest path. The cloud uploader must target `POST /api/sidecar/telemetry`. A future migration may deprecate or narrow the generic route only after every current caller is inventoried and ready.

Suggested append table:

```sql
CREATE TABLE sidecar_cloud_events (
  sequence_id BIGSERIAL PRIMARY KEY,
  install_id TEXT NOT NULL,
  session_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('cloud_private','shareable')),
  event_timestamp TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sidecar_cloud_events_install_time
  ON sidecar_cloud_events(install_id, event_timestamp DESC);

CREATE INDEX idx_sidecar_cloud_events_type_time
  ON sidecar_cloud_events(event_type, event_timestamp DESC);
```

Suggested projection tables:

```sql
CREATE TABLE fleet_projection_state (
  install_id TEXT PRIMARY KEY,
  version BIGINT NOT NULL,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_sequence_id BIGINT REFERENCES sidecar_cloud_events(sequence_id)
);

CREATE TABLE fleet_projection_deltas (
  install_id TEXT NOT NULL,
  version BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  delta_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (install_id, version)
);

CREATE INDEX idx_fleet_projection_deltas_install_created
  ON fleet_projection_deltas(install_id, created_at DESC);

CREATE TABLE battle_summary_projection (
  install_id TEXT NOT NULL,
  battle_key TEXT NOT NULL,
  summary_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (install_id, battle_key)
);

CREATE INDEX idx_battle_summary_projection_install_updated
  ON battle_summary_projection(install_id, updated_at DESC);

CREATE TABLE session_projection_state (
  install_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  state_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (install_id, session_id)
);
```

Projection rules:

- Every accepted event is appended first.
- Projection updates run in the same transaction when cheap; if not, enqueue a server-local projection job that does not call an LLM.
- `version` is monotonic per `install_id`.
- Superseding state events update current state and add a bounded delta row.
- Battle summaries upsert by `battle_key`.

Consumer APIs:

- `GET /api/fleet/state?sinceVersion=123`
  - Returns `304 Not Modified` when the caller's ETag or `sinceVersion` is current.
  - Returns `200` with `{ "version": 124, "state": {...}, "deltas": [...] }` when newer state exists.
  - Uses `ETag: W/"fleet:<install-id>:<version>"` and `Cache-Control: private, no-store` or a short private max-age depending on auth model.
- `GET /api/fleet/summaries?sinceVersion=123&limit=50`
  - Optional; returns bounded battle/session summaries only.
- `GET /api/fleet/health`
  - Cheap status for upload lag, last accepted event, projection version, and cloud-disabled visibility.

Consumer defaults:

- Poll no faster than every 5-15 seconds by default.
- Use `sinceVersion` and `If-None-Match`.
- Do not expose raw event-stream subscriptions until a concrete consumer need and cost profile exist.

## F. Security And Privacy Review

| Threat | Risk | Mitigation |
| --- | --- | --- |
| Local malware reads localhost traffic | Malware on the same machine can observe process memory or local traffic. | Treat localhost as a convenience boundary, not a security boundary. Keep payloads classified and redacted before cloud. Use launch-scoped local tokens. Avoid placing secrets in event payloads. |
| Leaked sidecar token | Cloud upload token could be reused to spam or upload stale data. | Store in OS-backed secret storage or env var, never JSONL/TOML. Scope token to telemetry ingest only. Support revocation. Rate-limit by token/install. Rotate on suspected leak. |
| Accidental raw sensitive upload | A broad object could include raw battle captures, coordinates, headers, or private protocol fields. | Cloud upload uses explicit allowlist builders. Majel uses strict validators that reject unknown event types and high-risk field names. Add forbidden-field tests. |
| Provider logging | Cloud provider or app logs could record request bodies or tokens. | Never log request bodies or auth headers. Log counts, event types, batch IDs, and idempotency keys only. Redact crash/error metadata. |
| Replay/dedup abuse | Attackers or bugs replay old batches to inflate state or storage. | Require `idempotencyKey`, unique constraints, timestamp skew limits, batch IDs, and token-scoped rate limits. Projection applies monotonic versions only. |
| Cloud endpoint spam | Endpoint can be hit with many batches. | Use existing rate-limit pattern plus body-size limits, max events per batch, token scopes, and cheap reject paths before DB work where possible. |
| User submits sensitive data | User may export diagnostics or enable upload without understanding payload sensitivity. | Make cloud upload opt-in and obvious to disable. Show classification labels. Keep local-only mode useful. Provide reviewable diagnostics bundles with redaction. |
| Crash logs contain payloads | Exceptions can include serialized payloads or paths. | Error handling must log event counts, type, key, and reason code, not full payload. Scrub `token`, `cookie`, `authorization`, `headers`, `raw`, `request`, `response` keys recursively before logging. |

## G. Tests And Profiling

Mod tests and live profiling:

- Hook enqueue path never waits on network, disk, SQLite, cloud auth, AI calls, or large serialization.
- Overload drops or coalesces instead of blocking.
- Drop counters increment and diagnostics are rate-limited.
- No gameplay mutation path is introduced; hooks remain read-only observation.
- Existing game costs, cooldowns, consumes, rewards, and mechanics are not altered.

Sidecar tests:

- SQLite WAL recovery after process crash or forced restart.
- Duplicate event handling in raw log and outbound queue.
- Outbound retry, exponential backoff, jitter, and 429/503 handling.
- Coalescing keeps latest fleet state per coalesce key.
- Redaction allowlist emits only cloud-safe fields.
- Cloud-disabled mode keeps local raw log and local projection working.
- Local-only mode works without Majel token and without UI.
- UI is not required for ingest, durability, or upload.

Majel tests:

- Strict ingest accepts only `stfc.telemetry.v1` cloud-safe event types.
- Forbidden fields are rejected, including `raw`, `headers`, `cookie`, `authorization`, `token`, `sessionHeader`, and raw battle token fields.
- Duplicate idempotency keys are accepted as duplicates without projection inflation.
- Projection version is monotonic per install.
- `sinceVersion` and `If-None-Match` return 304 when current and 200 when newer.
- Rate limits and body-size limits reject cheaply.
- No LLM call is reachable from ingest, projection, or fleet-state read APIs.

Instrumentation:

- `mod.telemetry.enqueue_ms`
- `mod.telemetry.queue_depth`
- `mod.telemetry.dropped_count`
- `sidecar.ingest.latency_ms`
- `sidecar.sqlite.write_ms`
- `sidecar.outbox.depth`
- `sidecar.outbox.batch_size`
- `sidecar.outbox.retry_count`
- `sidecar.outbox.coalesced_count`
- `majel.telemetry.ingest_ms`
- `majel.projection.update_ms`
- `majel.projection.read_ms`
- `consumer.poll.interval_ms`
- `consumer.poll.not_modified_count`

Profiling gates:

- Measure localhost HTTP ingest before any named-pipe work.
- Only consider named pipes if hook-to-broker handoff is a proven measurable cost and not fixable by batching/coalescing.

## H. PR-Sized Build Plan

1. Architecture doc and inventory
   - Land this document.
   - Link current mod sync, sidecar event store, sidecar integration docs, Majel ingest route/store, and current tests.

2. Sidecar broker skeleton
   - Extract a headless broker service from the current viewer/server shape or add a broker module the viewer can launch/observe.
   - No Majel-facing AI logic.
   - Add local status endpoint and metrics counters.

3. Cloud-safe schema package
   - Add TypeScript types and validators for `stfc.telemetry.v1`.
   - Add classification metadata and forbidden-field checks.
   - Add tests for all allowed and forbidden examples.

4. Local storage expansion
   - Add raw-log classification fields or a new `sidecar_raw_events` table.
   - Add `sidecar_outbox`.
   - Add `sidecar_fleet_projection`.
   - Add migration/recovery tests.

5. Sidecar redaction and outbox
   - Convert local events/observations into allowlisted cloud telemetry events.
   - Coalesce superseding fleet events.
   - Keep cloud-disabled local behavior intact.

6. Sidecar uploader
   - Batch every 250-1000 ms with jitter.
   - Retry with backoff.
   - Handle duplicate/accepted/dead-letter outcomes.
   - Add upload metrics and tests.

7. Majel strict ingest
  - Add `POST /api/sidecar/telemetry` as the strict cloud-safe boundary.
  - Keep the generic `POST /api/sidecar/events` route unchanged unless a later caller inventory justifies migration.
   - Add `sidecar_cloud_events` append table.
   - Reject unknown or forbidden fields by default.

8. Majel projection
   - Add fleet, battle summary, and session projection tables.
   - Apply projection updates without LLM calls.
   - Add idempotency and monotonic version tests.

9. Majel read APIs
   - Add `GET /api/fleet/state?sinceVersion=...` with ETag handling.
   - Add bounded recent summary API only if needed.
   - Add consumer-poll guidance and tests.

10. Mod observation tightening
    - Keep mod changes narrow and read-only.
    - Emit compact observations through the existing async boundary.
    - Add counters and overload drop behavior.

11. Profiling pass
    - Measure hook enqueue time, queue depth, sidecar ingest latency, and upload behavior.
    - Decide whether localhost HTTP remains acceptable.
    - Defer named pipes unless profiling proves need.

## Risk Register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Mod hook path accidentally grows heavy | High | Hard rule: no disk/network/SQLite/cloud/large serialization in hook path. Add enqueue timing counters and code review checklist. |
| Broad Majel ingest accepts raw sensitive events | High | Add strict cloud telemetry route and do not point uploader at broad canonical route until hardened. |
| Sidecar UI remains ingestion backbone | Medium | Move broker responsibilities into headless module/service and make UI an observer. |
| Local outbox grows without bound | Medium | Size/age caps, coalescing, dead-letter limits, and pressure trimming. |
| Consumer polling creates cost | Medium | ETag, `sinceVersion`, 304, minimum poll guidance, server-side rate limits. |
| Projection loses update ordering | Medium | Per-install monotonic versions and transactionally applied idempotency keys. |
| Privacy labels create false confidence | Medium | Use the term privacy-bounded. Keep allowlists strict and local-only mode useful. |
| Named-pipe optimization distracts from core durability | Low | Require profiling evidence before transport rewrite. |

## Explicit Non-Goals

- No automation engine.
- No gameplay mutation.
- No direct cloud sync from the mod.
- No raw event stream subscription for consumers.
- No LLM or AI call in ingest, upload, projection, or polling.
- No upload of raw battle captures by default.
- No use of heavy current sync payloads as the cloud contract.
- No named-pipe rewrite unless profiling proves localhost HTTP is a real bottleneck.
- No new dependency-heavy framework unless a later implementation note justifies it.
- No remote command channel from Majel to sidecar or mod.