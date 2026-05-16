import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { isSidecarEvent } from "../events/schema.js";
import type { SidecarEvent } from "../events/types.js";

export type SqlSidecarStoreBackend = "sqlite" | "postgres";

interface SqlSidecarStoreOptionsBase {
    tableName?: string;
}

export interface SqliteSidecarEventStoreOptions extends SqlSidecarStoreOptionsBase {
    backend: "sqlite";
    connection: string;
}

export interface PostgresSidecarEventStoreOptions extends SqlSidecarStoreOptionsBase {
    backend: "postgres";
    connection: string;
}

export type SqlSidecarEventStoreOptions = SqliteSidecarEventStoreOptions | PostgresSidecarEventStoreOptions;

export interface SidecarStoredEvent {
    sequenceId: number;
    eventKey: string;
    rawJson: string;
    event: SidecarEvent;
}

export interface SidecarEventStoreAppendResult {
    received: number;
    stored: number;
    duplicates: number;
}

export interface SidecarEventStore {
    readonly backend: SqlSidecarStoreBackend;
    append(events: readonly SidecarEvent[]): Promise<SidecarEventStoreAppendResult>;
    count(): Promise<number>;
    countByTypes(eventTypes: readonly string[]): Promise<number>;
    listRecent(limit: number): Promise<SidecarStoredEvent[]>;
    listRecentByTypes(eventTypes: readonly string[], limit: number): Promise<SidecarStoredEvent[]>;
    getBySequenceId(sequenceId: number): Promise<SidecarStoredEvent | null>;
    close(): Promise<void>;
}

type SqlParameter = string | number | bigint | Uint8Array | null;

interface SerializedSidecarEventRecord {
    eventKey: string;
    protocolVersion: string;
    eventType: string;
    schemaVersion: string | null;
    eventTimestamp: string;
    sessionId: string | null;
    modVersion: string | null;
    source: string | null;
    journalId: string | null;
    battleId: string | null;
    capturedAtUnixMs: number | null;
    rawJson: string;
}

interface SqlQueryResult {
    rowCount: number;
    rows: Array<Record<string, unknown>>;
}

interface SqlExecutor {
    exec(sql: string): Promise<void>;
    query(sql: string, params?: readonly SqlParameter[]): Promise<SqlQueryResult>;
    close(): Promise<void>;
}

interface SqlDialect {
    readonly backend: SqlSidecarStoreBackend;
    schemaStatements(tableName: string): string[];
    insertStatement(tableName: string): string;
    listRecentStatement(tableName: string): string;
    listRecentByTypesStatement(tableName: string, eventTypePlaceholders: string, limitPlaceholder: string): string;
    getBySequenceIdStatement(tableName: string): string;
    countStatement(tableName: string): string;
    countByTypesStatement(tableName: string, eventTypePlaceholders: string): string;
    placeholder(index: number): string;
    params(record: SerializedSidecarEventRecord): readonly SqlParameter[];
}

const DEFAULT_TABLE_NAME = "sidecar_events";

export async function createSqlSidecarEventStore(options: SqlSidecarEventStoreOptions): Promise<SidecarEventStore> {
    const tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    const executor = await createExecutor(options);
    const dialect = createDialect(options.backend);

    for (const statement of dialect.schemaStatements(tableName)) {
        await executor.exec(statement);
    }

    return new SqlSidecarEventStore(executor, dialect, tableName);
}

export function deriveSidecarEventKey(event: SidecarEvent): string {
    const rawJson = JSON.stringify(event);
    const schemaVersion = getOptionalString(event, "schemaVersion") ?? "v0";
    const journalId = getOptionalString(event, "journalId");
    if (journalId) {
        return `${event.type}:${schemaVersion}:${journalId}`;
    }

    return createHash("sha256").update(rawJson).digest("hex");
}

class SqlSidecarEventStore implements SidecarEventStore {
    readonly backend: SqlSidecarStoreBackend;

    constructor(
        private readonly executor: SqlExecutor,
        private readonly dialect: SqlDialect,
        private readonly tableName: string,
    ) {
        this.backend = dialect.backend;
    }

    async append(events: readonly SidecarEvent[]): Promise<SidecarEventStoreAppendResult> {
        let stored = 0;
        const insertStatement = this.dialect.insertStatement(this.tableName);

        for (const event of events) {
            const record = serializeEventRecord(event);
            const result = await this.executor.query(insertStatement, this.dialect.params(record));
            stored += result.rowCount;
        }

        return {
            received: events.length,
            stored,
            duplicates: events.length - stored,
        };
    }

    async count(): Promise<number> {
        const result = await this.executor.query(this.dialect.countStatement(this.tableName));
        return Number(result.rows[0]?.event_count ?? 0);
    }

    async countByTypes(eventTypes: readonly string[]): Promise<number> {
        const normalizedTypes = normalizeEventTypes(eventTypes);
        if (normalizedTypes.length === 0) {
            return 0;
        }

        const eventTypePlaceholders = normalizedTypes.map((_type, index) => this.dialect.placeholder(index + 1)).join(", ");
        const result = await this.executor.query(
            this.dialect.countByTypesStatement(this.tableName, eventTypePlaceholders),
            normalizedTypes,
        );
        return Number(result.rows[0]?.event_count ?? 0);
    }

    async listRecent(limit: number): Promise<SidecarStoredEvent[]> {
        const result = await this.executor.query(this.dialect.listRecentStatement(this.tableName), [limit]);
        return result.rows.map(deserializeStoredEventRow);
    }

    async listRecentByTypes(eventTypes: readonly string[], limit: number): Promise<SidecarStoredEvent[]> {
        const normalizedTypes = normalizeEventTypes(eventTypes);
        if (normalizedTypes.length === 0) {
            return [];
        }

        const eventTypePlaceholders = normalizedTypes.map((_type, index) => this.dialect.placeholder(index + 1)).join(", ");
        const limitPlaceholder = this.dialect.placeholder(normalizedTypes.length + 1);
        const result = await this.executor.query(
            this.dialect.listRecentByTypesStatement(this.tableName, eventTypePlaceholders, limitPlaceholder),
            [...normalizedTypes, limit],
        );
        return result.rows.map(deserializeStoredEventRow);
    }

    async getBySequenceId(sequenceId: number): Promise<SidecarStoredEvent | null> {
        const result = await this.executor.query(this.dialect.getBySequenceIdStatement(this.tableName), [sequenceId]);
        const row = result.rows[0];
        return row ? deserializeStoredEventRow(row) : null;
    }

    async close(): Promise<void> {
        await this.executor.close();
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
    constructor(private readonly pool: { query: (sql: string, params?: readonly SqlParameter[]) => Promise<{ rowCount?: number | null; rows: Array<Record<string, unknown>> }>; end: () => Promise<void> }) {}

    async exec(sql: string): Promise<void> {
        await this.pool.query(sql);
    }

    async query(sql: string, params: readonly SqlParameter[] = []): Promise<SqlQueryResult> {
        const result = await this.pool.query(sql, params);
        return {
            rowCount: Number(result.rowCount ?? 0),
            rows: result.rows,
        };
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}

async function createExecutor(options: SqlSidecarEventStoreOptions): Promise<SqlExecutor> {
    if (options.backend === "sqlite") {
        return new SqliteExecutor(path.resolve(options.connection));
    }

    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: options.connection });
    return new PostgresExecutor(pool);
}

function createDialect(backend: SqlSidecarStoreBackend): SqlDialect {
    return backend === "sqlite" ? sqliteDialect : postgresDialect;
}

const sqliteDialect: SqlDialect = {
    backend: "sqlite",
    schemaStatements(tableName) {
        return [
            `CREATE TABLE IF NOT EXISTS ${tableName} (\n                sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,\n                event_key TEXT NOT NULL UNIQUE,\n                protocol_version TEXT NOT NULL,\n                event_type TEXT NOT NULL,\n                schema_version TEXT,\n                event_timestamp TEXT NOT NULL,\n                session_id TEXT,\n                mod_version TEXT,\n                source TEXT,\n                journal_id TEXT,\n                battle_id TEXT,\n                captured_at_unix_ms INTEGER,\n                payload_json TEXT NOT NULL,\n                ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))\n            )`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_event_timestamp_idx ON ${tableName} (event_timestamp DESC)`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_event_type_idx ON ${tableName} (event_type, event_timestamp DESC)`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_journal_id_idx ON ${tableName} (journal_id)`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_battle_id_idx ON ${tableName} (battle_id)`,
        ];
    },
    insertStatement(tableName) {
        return `INSERT INTO ${tableName} (event_key, protocol_version, event_type, schema_version, event_timestamp, session_id, mod_version, source, journal_id, battle_id, captured_at_unix_ms, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT(event_key) DO NOTHING`;
    },
    listRecentStatement(tableName) {
        return `SELECT sequence_id, event_key, payload_json AS raw_json FROM ${tableName} ORDER BY sequence_id DESC LIMIT ?1`;
    },
    listRecentByTypesStatement(tableName, eventTypePlaceholders, limitPlaceholder) {
        return `SELECT sequence_id, event_key, payload_json AS raw_json FROM ${tableName} WHERE event_type IN (${eventTypePlaceholders}) ORDER BY sequence_id DESC LIMIT ${limitPlaceholder}`;
    },
    getBySequenceIdStatement(tableName) {
        return `SELECT sequence_id, event_key, payload_json AS raw_json FROM ${tableName} WHERE sequence_id = ?1`;
    },
    countStatement(tableName) {
        return `SELECT COUNT(*) AS event_count FROM ${tableName}`;
    },
    countByTypesStatement(tableName, eventTypePlaceholders) {
        return `SELECT COUNT(*) AS event_count FROM ${tableName} WHERE event_type IN (${eventTypePlaceholders})`;
    },
    placeholder(index) {
        return `?${index}`;
    },
    params(record) {
        return [
            record.eventKey,
            record.protocolVersion,
            record.eventType,
            record.schemaVersion,
            record.eventTimestamp,
            record.sessionId,
            record.modVersion,
            record.source,
            record.journalId,
            record.battleId,
            record.capturedAtUnixMs,
            record.rawJson,
        ];
    },
};

const postgresDialect: SqlDialect = {
    backend: "postgres",
    schemaStatements(tableName) {
        return [
            `CREATE TABLE IF NOT EXISTS ${tableName} (\n                sequence_id BIGSERIAL PRIMARY KEY,\n                event_key TEXT NOT NULL UNIQUE,\n                protocol_version TEXT NOT NULL,\n                event_type TEXT NOT NULL,\n                schema_version TEXT,\n                event_timestamp TIMESTAMPTZ NOT NULL,\n                session_id TEXT,\n                mod_version TEXT,\n                source TEXT,\n                journal_id TEXT,\n                battle_id TEXT,\n                captured_at_unix_ms BIGINT,\n                payload_json JSONB NOT NULL,\n                ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()\n            )`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_event_timestamp_idx ON ${tableName} (event_timestamp DESC)`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_event_type_idx ON ${tableName} (event_type, event_timestamp DESC)`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_journal_id_idx ON ${tableName} (journal_id)`,
            `CREATE INDEX IF NOT EXISTS ${tableName}_battle_id_idx ON ${tableName} (battle_id)`,
        ];
    },
    insertStatement(tableName) {
        return `INSERT INTO ${tableName} (event_key, protocol_version, event_type, schema_version, event_timestamp, session_id, mod_version, source, journal_id, battle_id, captured_at_unix_ms, payload_json) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10, $11, $12::jsonb) ON CONFLICT(event_key) DO NOTHING`;
    },
    listRecentStatement(tableName) {
        return `SELECT sequence_id, event_key, payload_json::text AS raw_json FROM ${tableName} ORDER BY sequence_id DESC LIMIT $1`;
    },
    listRecentByTypesStatement(tableName, eventTypePlaceholders, limitPlaceholder) {
        return `SELECT sequence_id, event_key, payload_json::text AS raw_json FROM ${tableName} WHERE event_type IN (${eventTypePlaceholders}) ORDER BY sequence_id DESC LIMIT ${limitPlaceholder}`;
    },
    getBySequenceIdStatement(tableName) {
        return `SELECT sequence_id, event_key, payload_json::text AS raw_json FROM ${tableName} WHERE sequence_id = $1`;
    },
    countStatement(tableName) {
        return `SELECT COUNT(*) AS event_count FROM ${tableName}`;
    },
    countByTypesStatement(tableName, eventTypePlaceholders) {
        return `SELECT COUNT(*) AS event_count FROM ${tableName} WHERE event_type IN (${eventTypePlaceholders})`;
    },
    placeholder(index) {
        return `$${index}`;
    },
    params(record) {
        return [
            record.eventKey,
            record.protocolVersion,
            record.eventType,
            record.schemaVersion,
            record.eventTimestamp,
            record.sessionId,
            record.modVersion,
            record.source,
            record.journalId,
            record.battleId,
            record.capturedAtUnixMs,
            record.rawJson,
        ];
    },
};

function serializeEventRecord(event: SidecarEvent): SerializedSidecarEventRecord {
    const rawJson = JSON.stringify(event);
    return {
        eventKey: deriveSidecarEventKey(event),
        protocolVersion: event.protocolVersion,
        eventType: event.type,
        schemaVersion: getOptionalString(event, "schemaVersion"),
        eventTimestamp: event.timestamp,
        sessionId: event.sessionId ?? null,
        modVersion: event.modVersion ?? null,
        source: event.source ?? null,
        journalId: getOptionalString(event, "journalId"),
        battleId: getOptionalString(event, "battleId"),
        capturedAtUnixMs: getOptionalNumber(event, "capturedAtUnixMs"),
        rawJson,
    };
}

function deserializeStoredEventRow(row: Record<string, unknown>): SidecarStoredEvent {
    const sequenceId = Number(row.sequence_id);
    const eventKey = String(row.event_key ?? "");
    const rawJson = String(row.raw_json ?? "");
    const parsed = JSON.parse(rawJson) as unknown;

    if (!Number.isFinite(sequenceId) || sequenceId <= 0) {
        throw new Error("Stored event row is missing a valid sequence_id.");
    }

    if (!eventKey || !isSidecarEvent(parsed)) {
        throw new Error("Stored event row is not a recognized sidecar event.");
    }

    return {
        sequenceId,
        eventKey,
        rawJson,
        event: parsed,
    };
}

function normalizeEventTypes(eventTypes: readonly string[]): string[] {
    return [...new Set(eventTypes.map((value) => value.trim()).filter(Boolean))];
}

function getOptionalString(value: object, key: string): string | null {
    const candidate = Reflect.get(value, key);
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function getOptionalNumber(value: object, key: string): number | null {
    const candidate = Reflect.get(value, key);
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function isSelectStatement(sql: string): boolean {
    return sql.trimStart().toUpperCase().startsWith("SELECT");
}