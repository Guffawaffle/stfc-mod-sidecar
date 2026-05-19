import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  FleetProjectionSlot,
  FleetSlotChangedEvent,
  FleetSnapshotEvent,
  FleetTelemetryEvent,
} from "./fleet-telemetry.js";

export type SqlFleetBrokerStoreBackend = "sqlite" | "postgres";

interface SqlFleetBrokerStoreOptionsBase {
  rawTableName?: string;
  outboxTableName?: string;
  projectionTableName?: string;
}

export interface SqliteFleetBrokerStoreOptions extends SqlFleetBrokerStoreOptionsBase {
  backend: "sqlite";
  connection: string;
}

export interface PostgresFleetBrokerStoreOptions extends SqlFleetBrokerStoreOptionsBase {
  backend: "postgres";
  connection: string;
}

export type SqlFleetBrokerStoreOptions = SqliteFleetBrokerStoreOptions | PostgresFleetBrokerStoreOptions;

export interface FleetBrokerStoreAppendResult {
  received: number;
  rawStored: number;
  duplicates: number;
  outboxInserted: number;
  outboxUpdated: number;
  projectionAdvanced: number;
  projectionNoOp: number;
  projectionStale: number;
}

export interface FleetOutboxEntry {
  outboxId: number;
  idempotencyKey: string;
  eventType: FleetTelemetryEvent["type"];
  schemaVersion: string;
  classification: string;
  projectionKey: string;
  coalesceKey: string | null;
  payloadJson: string;
  stateHash: string | null;
  status: "pending" | "in_flight" | "sent" | "dead";
  createdAt: string;
  updatedAt: string;
}

export interface FleetProjectionRecord {
  projectionKey: string;
  projectionType: "fleet";
  installId: string;
  sessionId: string;
  entityKey: string;
  stateVersion: number;
  stateHash: string;
  observedAt: string;
  updatedAt: string;
  slotCount: number;
  slots: FleetProjectionSlot[];
}

export interface FleetBrokerStoreSummary {
  backend: SqlFleetBrokerStoreBackend;
  rawEventCount: number;
  pendingOutboxCount: number;
  projectionCount: number;
  latestSequence: number;
  lastObservedAt: string | null;
  lastProjectedAt: string | null;
}

export interface FleetBrokerStore {
  readonly backend: SqlFleetBrokerStoreBackend;
  append(events: readonly FleetTelemetryEvent[]): Promise<FleetBrokerStoreAppendResult>;
  readProjection(projectionKey?: string): Promise<FleetProjectionRecord | null>;
  listPendingOutbox(limit?: number): Promise<FleetOutboxEntry[]>;
  readSequenceCursor(): Promise<number>;
  readSummary(): Promise<FleetBrokerStoreSummary>;
  close(): Promise<void>;
}

type SqlParameter = string | number | bigint | Uint8Array | null;

interface SqlQueryResult {
  rowCount: number;
  rows: Array<Record<string, unknown>>;
}

interface SqlExecutor {
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  query(sql: string, params?: readonly SqlParameter[]): Promise<SqlQueryResult>;
  close(): Promise<void>;
}

interface SqlDialect {
  readonly backend: SqlFleetBrokerStoreBackend;
  schemaStatements(tableNames: TableNames): string[];
  placeholder(index: number): string;
  insertRawStatement(tableName: string): string;
  upsertProjectionStatement(tableName: string): string;
  listPendingOutboxStatement(tableName: string, limitPlaceholder: string): string;
  findOutboxByIdempotencyStatement(tableName: string): string;
  findPendingOutboxByCoalesceStatement(tableName: string): string;
  insertOutboxStatement(tableName: string): string;
  updateOutboxStatement(tableName: string): string;
  readProjectionStatement(tableName: string): string;
  readLatestProjectionStatement(tableName: string): string;
  readSummaryStatement(tableNames: TableNames): string;
  readSequenceCursorStatement(tableName: string): string;
}

interface TableNames {
  raw: string;
  outbox: string;
  projection: string;
}

interface SerializedFleetTelemetryEvent {
  event: FleetTelemetryEvent;
  eventKey: string;
  eventType: FleetTelemetryEvent["type"];
  schemaVersion: string;
  classification: string;
  installId: string;
  sessionId: string;
  projectionKey: string;
  entityKey: string;
  coalesceKey: string | null;
  stateVersion: number;
  observedAt: string;
  payloadJson: string;
}

interface FleetProjectionDocument {
  slots: FleetProjectionSlot[];
}

type ProjectionOutcome =
  | { status: "advanced"; projection: FleetProjectionRecord }
  | { status: "noop" }
  | { status: "stale" };

const DEFAULT_RAW_TABLE_NAME = "sidecar_raw_events";
const DEFAULT_OUTBOX_TABLE_NAME = "sidecar_outbox";
const DEFAULT_PROJECTION_TABLE_NAME = "sidecar_fleet_projection";

export async function createSqlFleetBrokerStore(options: SqlFleetBrokerStoreOptions): Promise<FleetBrokerStore> {
  const tableNames: TableNames = {
    raw: options.rawTableName ?? DEFAULT_RAW_TABLE_NAME,
    outbox: options.outboxTableName ?? DEFAULT_OUTBOX_TABLE_NAME,
    projection: options.projectionTableName ?? DEFAULT_PROJECTION_TABLE_NAME,
  };
  const executor = await createExecutor(options);
  const dialect = createDialect(options.backend);

  for (const statement of dialect.schemaStatements(tableNames)) {
    await executor.exec(statement);
  }

  return new SqlFleetBrokerStore(executor, dialect, tableNames);
}

class SqlFleetBrokerStore implements FleetBrokerStore {
  readonly backend: SqlFleetBrokerStoreBackend;

  constructor(
    private readonly executor: SqlExecutor,
    private readonly dialect: SqlDialect,
    private readonly tableNames: TableNames,
  ) {
    this.backend = dialect.backend;
  }

  async append(events: readonly FleetTelemetryEvent[]): Promise<FleetBrokerStoreAppendResult> {
    const projectionCache = new Map<string, FleetProjectionRecord | null>();
    let rawStored = 0;
    let duplicates = 0;
    let outboxInserted = 0;
    let outboxUpdated = 0;
    let projectionAdvanced = 0;
    let projectionNoOp = 0;
    let projectionStale = 0;

    await this.executor.begin();
    try {
      for (const event of events) {
        const record = serializeFleetTelemetryEvent(event);
        const inserted = await this.executor.query(
          this.dialect.insertRawStatement(this.tableNames.raw),
          rawParams(record),
        );
        if (inserted.rowCount === 0) {
          duplicates += 1;
          continue;
        }

        rawStored += 1;
        const currentProjection = projectionCache.has(record.projectionKey)
          ? projectionCache.get(record.projectionKey) ?? null
          : await this.readProjectionRecord(record.projectionKey);
        projectionCache.set(record.projectionKey, currentProjection);

        const projectionOutcome = applyProjectionEvent(currentProjection, record);
        if (projectionOutcome.status === "noop") {
          projectionNoOp += 1;
          continue;
        }

        if (projectionOutcome.status === "stale") {
          projectionStale += 1;
          continue;
        }

        await this.executor.query(
          this.dialect.upsertProjectionStatement(this.tableNames.projection),
          projectionParams(projectionOutcome.projection, record.eventKey),
        );
        projectionCache.set(record.projectionKey, projectionOutcome.projection);
        projectionAdvanced += 1;

        const outboxResult = await this.writeOutboxRecord(record, projectionOutcome.projection.stateHash);
        if (outboxResult === "inserted") {
          outboxInserted += 1;
        } else if (outboxResult === "updated") {
          outboxUpdated += 1;
        }
      }

      await this.executor.commit();
    } catch (error) {
      await this.executor.rollback();
      throw error;
    }

    return {
      received: events.length,
      rawStored,
      duplicates,
      outboxInserted,
      outboxUpdated,
      projectionAdvanced,
      projectionNoOp,
      projectionStale,
    };
  }

  async readProjection(projectionKey?: string): Promise<FleetProjectionRecord | null> {
    if (projectionKey) {
      return this.readProjectionRecord(projectionKey);
    }

    const result = await this.executor.query(
      this.dialect.readLatestProjectionStatement(this.tableNames.projection),
    );
    return parseProjectionRow(result.rows[0]);
  }

  async listPendingOutbox(limit = 100): Promise<FleetOutboxEntry[]> {
    const limitPlaceholder = this.dialect.placeholder(1);
    const result = await this.executor.query(
      this.dialect.listPendingOutboxStatement(this.tableNames.outbox, limitPlaceholder),
      [limit],
    );
    return result.rows.map(parseOutboxRow).filter(isDefined);
  }

  async readSequenceCursor(): Promise<number> {
    const result = await this.executor.query(
      this.dialect.readSequenceCursorStatement(this.tableNames.raw),
    );
    return Number(result.rows[0]?.latest_sequence ?? 0);
  }

  async readSummary(): Promise<FleetBrokerStoreSummary> {
    const result = await this.executor.query(this.dialect.readSummaryStatement(this.tableNames));
    return {
      backend: this.backend,
      rawEventCount: Number(result.rows[0]?.raw_event_count ?? 0),
      pendingOutboxCount: Number(result.rows[0]?.pending_outbox_count ?? 0),
      projectionCount: Number(result.rows[0]?.projection_count ?? 0),
      latestSequence: Number(result.rows[0]?.latest_sequence ?? 0),
      lastObservedAt: optionalString(result.rows[0]?.last_observed_at),
      lastProjectedAt: optionalString(result.rows[0]?.last_projected_at),
    };
  }

  async close(): Promise<void> {
    await this.executor.close();
  }

  private async readProjectionRecord(projectionKey: string): Promise<FleetProjectionRecord | null> {
    const result = await this.executor.query(
      this.dialect.readProjectionStatement(this.tableNames.projection),
      [projectionKey],
    );
    return parseProjectionRow(result.rows[0]);
  }

  private async writeOutboxRecord(
    record: SerializedFleetTelemetryEvent,
    stateHash: string,
  ): Promise<"inserted" | "updated" | "duplicate"> {
    const duplicateCheck = await this.executor.query(
      this.dialect.findOutboxByIdempotencyStatement(this.tableNames.outbox),
      [record.eventKey],
    );
    if (duplicateCheck.rows.length > 0) {
      return "duplicate";
    }

    if (record.coalesceKey) {
      const existing = await this.executor.query(
        this.dialect.findPendingOutboxByCoalesceStatement(this.tableNames.outbox),
        [record.coalesceKey],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        const outboxId = Number(existingRow.outbox_id ?? 0);
        if (outboxId > 0) {
          await this.executor.query(
            this.dialect.updateOutboxStatement(this.tableNames.outbox),
            updateOutboxParams(record, stateHash, outboxId),
          );
          return "updated";
        }
      }
    }

    const inserted = await this.executor.query(
      this.dialect.insertOutboxStatement(this.tableNames.outbox),
      insertOutboxParams(record, stateHash),
    );
    return inserted.rowCount > 0 ? "inserted" : "duplicate";
  }
}

class SqliteExecutor implements SqlExecutor {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.database.exec("PRAGMA journal_mode = WAL");
  }

  async exec(sql: string): Promise<void> {
    this.database.exec(sql);
  }

  async begin(): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
  }

  async commit(): Promise<void> {
    this.database.exec("COMMIT");
  }

  async rollback(): Promise<void> {
    this.database.exec("ROLLBACK");
  }

  async query(sql: string, params: readonly SqlParameter[] = []): Promise<SqlQueryResult> {
    const statement = this.database.prepare(sql);
    if (isSelectStatement(sql)) {
      const rows = statement.all(...params) as Array<Record<string, unknown>>;
      return { rowCount: rows.length, rows };
    }

    const result = statement.run(...params) as { changes?: number };
    return { rowCount: Number(result.changes ?? 0), rows: [] };
  }

  async close(): Promise<void> {
    this.database.close();
  }
}

class PostgresExecutor implements SqlExecutor {
  constructor(
    private readonly client: { query: (sql: string, params?: readonly SqlParameter[]) => Promise<{ rowCount?: number | null; rows: Array<Record<string, unknown>> }> },
    private readonly release: () => void,
    private readonly end: () => Promise<void>,
  ) {}

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async begin(): Promise<void> {
    await this.client.query("BEGIN");
  }

  async commit(): Promise<void> {
    await this.client.query("COMMIT");
  }

  async rollback(): Promise<void> {
    await this.client.query("ROLLBACK");
  }

  async query(sql: string, params: readonly SqlParameter[] = []): Promise<SqlQueryResult> {
    const result = await this.client.query(sql, params);
    return {
      rowCount: Number(result.rowCount ?? 0),
      rows: result.rows,
    };
  }

  async close(): Promise<void> {
    this.release();
    await this.end();
  }
}

async function createExecutor(options: SqlFleetBrokerStoreOptions): Promise<SqlExecutor> {
  if (options.backend === "sqlite") {
    return new SqliteExecutor(path.resolve(options.connection));
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: options.connection });
  const client = await pool.connect();
  return new PostgresExecutor(client, () => client.release(), () => pool.end());
}

function createDialect(backend: SqlFleetBrokerStoreBackend): SqlDialect {
  return backend === "sqlite" ? sqliteDialect : postgresDialect;
}

const sqliteDialect: SqlDialect = {
  backend: "sqlite",
  schemaStatements(tableNames) {
    return [
      `CREATE TABLE IF NOT EXISTS ${tableNames.raw} (
        raw_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        classification TEXT NOT NULL,
        install_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        coalesce_key TEXT,
        state_version INTEGER NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.raw}_observed_idx ON ${tableNames.raw} (observed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.raw}_projection_idx ON ${tableNames.raw} (projection_key, state_version DESC)`,
      `CREATE TABLE IF NOT EXISTS ${tableNames.outbox} (
        outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        classification TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        coalesce_key TEXT,
        payload_json TEXT NOT NULL,
        state_hash TEXT,
        created_at TEXT NOT NULL,
        not_before_at TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL,
        sent_at TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.outbox}_status_idx ON ${tableNames.outbox} (status, not_before_at, outbox_id)`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.outbox}_coalesce_idx ON ${tableNames.outbox} (coalesce_key, status)`,
      `CREATE TABLE IF NOT EXISTS ${tableNames.projection} (
        projection_key TEXT PRIMARY KEY,
        projection_type TEXT NOT NULL,
        install_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        state_version INTEGER NOT NULL,
        state_hash TEXT NOT NULL,
        state_json TEXT NOT NULL,
        source_event_key TEXT,
        observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.projection}_updated_idx ON ${tableNames.projection} (updated_at DESC)`,
    ];
  },
  placeholder(index) {
    return `?${index}`;
  },
  insertRawStatement(tableName) {
    return `INSERT OR IGNORE INTO ${tableName} (
      event_key,
      event_type,
      schema_version,
      classification,
      install_id,
      session_id,
      projection_key,
      entity_key,
      coalesce_key,
      state_version,
      observed_at,
      payload_json,
      ingested_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`;
  },
  upsertProjectionStatement(tableName) {
    return `INSERT INTO ${tableName} (
      projection_key,
      projection_type,
      install_id,
      session_id,
      entity_key,
      state_version,
      state_hash,
      state_json,
      source_event_key,
      observed_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT(projection_key) DO UPDATE SET
      projection_type = excluded.projection_type,
      install_id = excluded.install_id,
      session_id = excluded.session_id,
      entity_key = excluded.entity_key,
      state_version = excluded.state_version,
      state_hash = excluded.state_hash,
      state_json = excluded.state_json,
      source_event_key = excluded.source_event_key,
      observed_at = excluded.observed_at,
      updated_at = excluded.updated_at`;
  },
  listPendingOutboxStatement(tableName, limitPlaceholder) {
    return `SELECT outbox_id, idempotency_key, event_type, schema_version, classification, projection_key, coalesce_key, payload_json, state_hash, status, created_at, updated_at
      FROM ${tableName}
      WHERE status = 'pending'
      ORDER BY outbox_id ASC
      LIMIT ${limitPlaceholder}`;
  },
  findOutboxByIdempotencyStatement(tableName) {
    return `SELECT outbox_id FROM ${tableName} WHERE idempotency_key = ?1 LIMIT 1`;
  },
  findPendingOutboxByCoalesceStatement(tableName) {
    return `SELECT outbox_id FROM ${tableName} WHERE coalesce_key = ?1 AND status = 'pending' ORDER BY outbox_id DESC LIMIT 1`;
  },
  insertOutboxStatement(tableName) {
    return `INSERT OR IGNORE INTO ${tableName} (
      idempotency_key,
      event_type,
      schema_version,
      classification,
      projection_key,
      coalesce_key,
      payload_json,
      state_hash,
      created_at,
      not_before_at,
      attempt_count,
      last_attempt_at,
      last_error,
      status,
      sent_at,
      updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, NULL, NULL, 'pending', NULL, ?11)`;
  },
  updateOutboxStatement(tableName) {
    return `UPDATE ${tableName} SET
      idempotency_key = ?1,
      event_type = ?2,
      schema_version = ?3,
      classification = ?4,
      projection_key = ?5,
      coalesce_key = ?6,
      payload_json = ?7,
      state_hash = ?8,
      not_before_at = ?9,
      attempt_count = 0,
      last_attempt_at = NULL,
      last_error = NULL,
      status = 'pending',
      sent_at = NULL,
      updated_at = ?10
      WHERE outbox_id = ?11`;
  },
  readProjectionStatement(tableName) {
    return `SELECT projection_key, projection_type, install_id, session_id, entity_key, state_version, state_hash, state_json, observed_at, updated_at
      FROM ${tableName}
      WHERE projection_key = ?1
      LIMIT 1`;
  },
  readLatestProjectionStatement(tableName) {
    return `SELECT projection_key, projection_type, install_id, session_id, entity_key, state_version, state_hash, state_json, observed_at, updated_at
      FROM ${tableName}
      ORDER BY updated_at DESC, projection_key ASC
      LIMIT 1`;
  },
  readSummaryStatement(tableNames) {
    return `SELECT
      (SELECT COUNT(*) FROM ${tableNames.raw}) AS raw_event_count,
      (SELECT COUNT(*) FROM ${tableNames.outbox} WHERE status = 'pending') AS pending_outbox_count,
      (SELECT COUNT(*) FROM ${tableNames.projection}) AS projection_count,
      (SELECT COALESCE(MAX(state_version), 0) FROM ${tableNames.raw}) AS latest_sequence,
      (SELECT MAX(observed_at) FROM ${tableNames.raw}) AS last_observed_at,
      (SELECT MAX(updated_at) FROM ${tableNames.projection}) AS last_projected_at`;
  },
  readSequenceCursorStatement(tableName) {
    return `SELECT COALESCE(MAX(state_version), 0) AS latest_sequence FROM ${tableName}`;
  },
};

const postgresDialect: SqlDialect = {
  backend: "postgres",
  schemaStatements(tableNames) {
    return [
      `CREATE TABLE IF NOT EXISTS ${tableNames.raw} (
        raw_id BIGSERIAL PRIMARY KEY,
        event_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        classification TEXT NOT NULL,
        install_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        coalesce_key TEXT,
        state_version BIGINT NOT NULL,
        observed_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.raw}_observed_idx ON ${tableNames.raw} (observed_at DESC)`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.raw}_projection_idx ON ${tableNames.raw} (projection_key, state_version DESC)`,
      `CREATE TABLE IF NOT EXISTS ${tableNames.outbox} (
        outbox_id BIGSERIAL PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        classification TEXT NOT NULL,
        projection_key TEXT NOT NULL,
        coalesce_key TEXT,
        payload_json TEXT NOT NULL,
        state_hash TEXT,
        created_at TEXT NOT NULL,
        not_before_at TEXT NOT NULL,
        attempt_count BIGINT NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_error TEXT,
        status TEXT NOT NULL,
        sent_at TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.outbox}_status_idx ON ${tableNames.outbox} (status, not_before_at, outbox_id)`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.outbox}_coalesce_idx ON ${tableNames.outbox} (coalesce_key, status)`,
      `CREATE TABLE IF NOT EXISTS ${tableNames.projection} (
        projection_key TEXT PRIMARY KEY,
        projection_type TEXT NOT NULL,
        install_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        entity_key TEXT NOT NULL,
        state_version BIGINT NOT NULL,
        state_hash TEXT NOT NULL,
        state_json TEXT NOT NULL,
        source_event_key TEXT,
        observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS ${tableNames.projection}_updated_idx ON ${tableNames.projection} (updated_at DESC)`,
    ];
  },
  placeholder(index) {
    return `$${index}`;
  },
  insertRawStatement(tableName) {
    return `INSERT INTO ${tableName} (
      event_key,
      event_type,
      schema_version,
      classification,
      install_id,
      session_id,
      projection_key,
      entity_key,
      coalesce_key,
      state_version,
      observed_at,
      payload_json,
      ingested_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT(event_key) DO NOTHING`;
  },
  upsertProjectionStatement(tableName) {
    return `INSERT INTO ${tableName} (
      projection_key,
      projection_type,
      install_id,
      session_id,
      entity_key,
      state_version,
      state_hash,
      state_json,
      source_event_key,
      observed_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT(projection_key) DO UPDATE SET
      projection_type = excluded.projection_type,
      install_id = excluded.install_id,
      session_id = excluded.session_id,
      entity_key = excluded.entity_key,
      state_version = excluded.state_version,
      state_hash = excluded.state_hash,
      state_json = excluded.state_json,
      source_event_key = excluded.source_event_key,
      observed_at = excluded.observed_at,
      updated_at = excluded.updated_at`;
  },
  listPendingOutboxStatement(tableName, limitPlaceholder) {
    return `SELECT outbox_id, idempotency_key, event_type, schema_version, classification, projection_key, coalesce_key, payload_json, state_hash, status, created_at, updated_at
      FROM ${tableName}
      WHERE status = 'pending'
      ORDER BY outbox_id ASC
      LIMIT ${limitPlaceholder}`;
  },
  findOutboxByIdempotencyStatement(tableName) {
    return `SELECT outbox_id FROM ${tableName} WHERE idempotency_key = $1 LIMIT 1`;
  },
  findPendingOutboxByCoalesceStatement(tableName) {
    return `SELECT outbox_id FROM ${tableName} WHERE coalesce_key = $1 AND status = 'pending' ORDER BY outbox_id DESC LIMIT 1`;
  },
  insertOutboxStatement(tableName) {
    return `INSERT INTO ${tableName} (
      idempotency_key,
      event_type,
      schema_version,
      classification,
      projection_key,
      coalesce_key,
      payload_json,
      state_hash,
      created_at,
      not_before_at,
      attempt_count,
      last_attempt_at,
      last_error,
      status,
      sent_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, NULL, NULL, 'pending', NULL, $11)
    ON CONFLICT(idempotency_key) DO NOTHING`;
  },
  updateOutboxStatement(tableName) {
    return `UPDATE ${tableName} SET
      idempotency_key = $1,
      event_type = $2,
      schema_version = $3,
      classification = $4,
      projection_key = $5,
      coalesce_key = $6,
      payload_json = $7,
      state_hash = $8,
      not_before_at = $9,
      attempt_count = 0,
      last_attempt_at = NULL,
      last_error = NULL,
      status = 'pending',
      sent_at = NULL,
      updated_at = $10
      WHERE outbox_id = $11`;
  },
  readProjectionStatement(tableName) {
    return `SELECT projection_key, projection_type, install_id, session_id, entity_key, state_version, state_hash, state_json, observed_at, updated_at
      FROM ${tableName}
      WHERE projection_key = $1
      LIMIT 1`;
  },
  readLatestProjectionStatement(tableName) {
    return `SELECT projection_key, projection_type, install_id, session_id, entity_key, state_version, state_hash, state_json, observed_at, updated_at
      FROM ${tableName}
      ORDER BY updated_at DESC, projection_key ASC
      LIMIT 1`;
  },
  readSummaryStatement(tableNames) {
    return `SELECT
      (SELECT COUNT(*) FROM ${tableNames.raw}) AS raw_event_count,
      (SELECT COUNT(*) FROM ${tableNames.outbox} WHERE status = 'pending') AS pending_outbox_count,
      (SELECT COUNT(*) FROM ${tableNames.projection}) AS projection_count,
      (SELECT COALESCE(MAX(state_version), 0) FROM ${tableNames.raw}) AS latest_sequence,
      (SELECT MAX(observed_at) FROM ${tableNames.raw}) AS last_observed_at,
      (SELECT MAX(updated_at) FROM ${tableNames.projection}) AS last_projected_at`;
  },
  readSequenceCursorStatement(tableName) {
    return `SELECT COALESCE(MAX(state_version), 0) AS latest_sequence FROM ${tableName}`;
  },
};

function serializeFleetTelemetryEvent(event: FleetTelemetryEvent): SerializedFleetTelemetryEvent {
  return {
    event,
    eventKey: event.idempotencyKey,
    eventType: event.type,
    schemaVersion: event.schemaVersion,
    classification: event.classification,
    installId: event.installId,
    sessionId: event.sessionId,
    projectionKey: projectionKeyForInstall(event.installId),
    entityKey: entityKeyForEvent(event),
    coalesceKey: event.coalesceKey,
    stateVersion: stateVersionForEvent(event),
    observedAt: event.observedAt,
    payloadJson: JSON.stringify(event),
  };
}

function rawParams(record: SerializedFleetTelemetryEvent): readonly SqlParameter[] {
  return [
    record.eventKey,
    record.eventType,
    record.schemaVersion,
    record.classification,
    record.installId,
    record.sessionId,
    record.projectionKey,
    record.entityKey,
    record.coalesceKey,
    record.stateVersion,
    record.observedAt,
    record.payloadJson,
    record.observedAt,
  ];
}

function projectionParams(projection: FleetProjectionRecord, sourceEventKey: string): readonly SqlParameter[] {
  return [
    projection.projectionKey,
    projection.projectionType,
    projection.installId,
    projection.sessionId,
    projection.entityKey,
    projection.stateVersion,
    projection.stateHash,
    JSON.stringify({ slots: projection.slots }),
    sourceEventKey,
    projection.observedAt,
    projection.updatedAt,
  ];
}

function insertOutboxParams(record: SerializedFleetTelemetryEvent, stateHash: string): readonly SqlParameter[] {
  return [
    record.eventKey,
    record.eventType,
    record.schemaVersion,
    record.classification,
    record.projectionKey,
    record.coalesceKey,
    record.payloadJson,
    stateHash,
    record.observedAt,
    record.observedAt,
    record.observedAt,
  ];
}

function updateOutboxParams(
  record: SerializedFleetTelemetryEvent,
  stateHash: string,
  outboxId: number,
): readonly SqlParameter[] {
  return [
    record.eventKey,
    record.eventType,
    record.schemaVersion,
    record.classification,
    record.projectionKey,
    record.coalesceKey,
    record.payloadJson,
    stateHash,
    record.observedAt,
    record.observedAt,
    outboxId,
  ];
}

function applyProjectionEvent(
  current: FleetProjectionRecord | null,
  record: SerializedFleetTelemetryEvent,
): ProjectionOutcome {
  const currentSlots = current?.slots ?? [];
  const nextSlots = record.event.type === "fleet.snapshot"
    ? applySnapshotSlots(currentSlots, record.event)
    : applySlotChange(currentSlots, record.event);
  const nextStateHash = hashProjectionSlots(nextSlots);
  if (current && nextStateHash === current.stateHash) {
    return { status: "noop" };
  }

  if (current && current.sessionId === record.sessionId && record.stateVersion <= current.stateVersion) {
    return { status: "stale" };
  }

  return {
    status: "advanced",
    projection: {
      projectionKey: record.projectionKey,
      projectionType: "fleet",
      installId: record.installId,
      sessionId: record.sessionId,
      entityKey: record.projectionKey,
      stateVersion: record.stateVersion,
      stateHash: nextStateHash,
      observedAt: record.observedAt,
      updatedAt: record.observedAt,
      slotCount: nextSlots.length,
      slots: nextSlots,
    },
  };
}

function applySnapshotSlots(currentSlots: readonly FleetProjectionSlot[], event: FleetSnapshotEvent): FleetProjectionSlot[] {
  if (event.snapshotId.startsWith("runtime-")) {
    return normalizeProjectionSlots(event.slots);
  }

  const preserved = currentSlots.filter((slot) => !slot.slotKey.startsWith("ship-"));
  return normalizeProjectionSlots([...preserved, ...event.slots]);
}

function applySlotChange(currentSlots: readonly FleetProjectionSlot[], event: FleetSlotChangedEvent): FleetProjectionSlot[] {
  const slots = new Map(currentSlots.map((slot) => [slot.slotKey, normalizeProjectionSlot(slot)]));
  slots.set(event.slotKey, normalizeProjectionSlot({
    slotKey: event.slotKey,
    fleetKey: event.fleetKey,
    state: event.currentState,
    assignmentKind: event.assignmentKind,
    updatedAt: event.observedAt,
  }));
  return normalizeProjectionSlots([...slots.values()]);
}

function normalizeProjectionSlots(slots: readonly FleetProjectionSlot[]): FleetProjectionSlot[] {
  const deduped = new Map<string, FleetProjectionSlot>();
  for (const slot of slots) {
    const normalized = normalizeProjectionSlot(slot);
    deduped.set(normalized.slotKey, normalized);
  }

  return [...deduped.values()]
    .sort((left, right) => left.slotKey.localeCompare(right.slotKey));
}

function normalizeProjectionSlot(slot: FleetProjectionSlot): FleetProjectionSlot {
  return {
    slotKey: slot.slotKey,
    fleetKey: slot.fleetKey,
    state: slot.state,
    assignmentKind: slot.assignmentKind,
    updatedAt: slot.updatedAt,
    ...(slot.shipKeyHash ? { shipKeyHash: slot.shipKeyHash } : {}),
    ...(slot.shipType ? { shipType: slot.shipType } : {}),
    ...(slot.levelBand ? { levelBand: slot.levelBand } : {}),
    ...(slot.healthBand ? { healthBand: slot.healthBand } : {}),
  };
}

function hashProjectionSlots(slots: readonly FleetProjectionSlot[]): string {
  return createHash("sha256").update(JSON.stringify(normalizeProjectionSlots(slots))).digest("hex");
}

function projectionKeyForInstall(installId: string): string {
  return `fleet:${installId}`;
}

function entityKeyForEvent(event: FleetTelemetryEvent): string {
  return event.type === "fleet.snapshot" ? projectionKeyForInstall(event.installId) : event.slotKey;
}

function stateVersionForEvent(event: FleetTelemetryEvent): number {
  return event.type === "fleet.snapshot" ? event.snapshotVersion : event.stateVersion;
}

function parseProjectionRow(row: Record<string, unknown> | undefined): FleetProjectionRecord | null {
  if (!row) {
    return null;
  }

  const stateJson = optionalString(row.state_json) ?? "{}";
  const document = safeJsonParse<FleetProjectionDocument>(stateJson) ?? { slots: [] };
  return {
    projectionKey: requiredString(row.projection_key),
    projectionType: "fleet",
    installId: requiredString(row.install_id),
    sessionId: requiredString(row.session_id),
    entityKey: requiredString(row.entity_key),
    stateVersion: Number(row.state_version ?? 0),
    stateHash: requiredString(row.state_hash),
    observedAt: requiredString(row.observed_at),
    updatedAt: requiredString(row.updated_at),
    slotCount: Array.isArray(document.slots) ? document.slots.length : 0,
    slots: Array.isArray(document.slots) ? document.slots.map(normalizeProjectionSlot) : [],
  };
}

function parseOutboxRow(row: Record<string, unknown>): FleetOutboxEntry | null {
  const status = optionalString(row.status);
  if (!status || !isOutboxStatus(status)) {
    return null;
  }

  const eventType = optionalString(row.event_type);
  if (!eventType || (eventType !== "fleet.snapshot" && eventType !== "fleet.slot.changed")) {
    return null;
  }

  return {
    outboxId: Number(row.outbox_id ?? 0),
    idempotencyKey: requiredString(row.idempotency_key),
    eventType,
    schemaVersion: requiredString(row.schema_version),
    classification: requiredString(row.classification),
    projectionKey: requiredString(row.projection_key),
    coalesceKey: optionalString(row.coalesce_key),
    payloadJson: requiredString(row.payload_json),
    stateHash: optionalString(row.state_hash),
    status,
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  };
}

function requiredString(value: unknown): string {
  return String(value ?? "");
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return value == null ? null : String(value);
  }
  return value;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isOutboxStatus(value: string): value is FleetOutboxEntry["status"] {
  return value === "pending" || value === "in_flight" || value === "sent" || value === "dead";
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isSelectStatement(sql: string): boolean {
  return sql.trimStart().toUpperCase().startsWith("SELECT");
}