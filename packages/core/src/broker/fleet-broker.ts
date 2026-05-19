import {
  buildFleetRuntimeTelemetryEvents,
  buildFleetTelemetryEvents,
  extractFleetRuntimeMajelEnvelopes,
  normalizeFleetSyncPayload,
  SIDECAR_TELEMETRY_PROTOCOL_VERSION,
  type FleetTelemetryEvent,
  type FleetProjectionSlot,
} from "./fleet-telemetry.js";
import { summarizeFleetBrokerError } from "./error-summary.js";
import type {
  FleetBrokerStore,
  FleetBrokerStoreAppendResult,
  FleetBrokerStoreSummary,
  FleetOutboxEntry,
} from "./sql-broker-store.js";

export interface FleetBrokerProjectionSnapshot {
  projectionKey: string;
  installId: string;
  sessionId: string;
  stateVersion: number;
  stateHash: string;
  observedAt: string;
  updatedAt: string;
  slotCount: number;
  slots: FleetProjectionSlot[];
}

export interface FleetBrokerIngestResult extends FleetBrokerStoreAppendResult {
  ok: true;
  protocolVersion: typeof SIDECAR_TELEMETRY_PROTOCOL_VERSION;
  received: number;
  accepted: number;
  cloudUploadEnabled: boolean;
}

export interface FleetBrokerStatusSummary extends FleetBrokerStoreSummary {
  available: true;
  cloudUploadEnabled: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface FleetBrokerReadProjectionResult {
  ok: true;
  available: boolean;
  generatedAt: string;
  cloudUploadEnabled: boolean;
  projection: FleetBrokerProjectionSnapshot | null;
}

export interface FleetTelemetryBroker {
  readonly backend: FleetBrokerStore["backend"];
  ingestSyncPayload(payload: unknown): Promise<FleetBrokerIngestResult>;
  ingestFleetRuntimePayload(payload: unknown): Promise<FleetBrokerIngestResult>;
  readProjection(): Promise<FleetBrokerReadProjectionResult>;
  listPendingOutbox(limit?: number): Promise<FleetOutboxEntry[]>;
  status(): Promise<FleetBrokerStatusSummary>;
  close(): Promise<void>;
}

export interface CreateFleetTelemetryBrokerOptions {
  store: FleetBrokerStore;
  installId: string;
  sessionId: string;
  sidecarVersion: string;
  cloudUploadEnabled?: boolean;
  now?: () => Date;
}

export async function createFleetTelemetryBroker(
  options: CreateFleetTelemetryBrokerOptions,
): Promise<FleetTelemetryBroker> {
  return FleetTelemetryBrokerImpl.create(options);
}

class FleetTelemetryBrokerImpl implements FleetTelemetryBroker {
  readonly backend;

  private constructor(
    private readonly store: FleetBrokerStore,
    private readonly installId: string,
    private readonly sessionId: string,
    private readonly sidecarVersion: string,
    private readonly cloudUploadEnabled: boolean,
    private readonly now: () => Date,
    private sequence: number,
    private lastError: string | null,
    private lastErrorAt: string | null,
  ) {
    this.backend = store.backend;
  }

  static async create(options: CreateFleetTelemetryBrokerOptions): Promise<FleetTelemetryBrokerImpl> {
    const sequence = await options.store.readSequenceCursor();
    return new FleetTelemetryBrokerImpl(
      options.store,
      options.installId,
      options.sessionId,
      options.sidecarVersion,
      Boolean(options.cloudUploadEnabled),
      options.now ?? (() => new Date()),
      sequence,
      null,
      null,
    );
  }

  async ingestSyncPayload(payload: unknown): Promise<FleetBrokerIngestResult> {
    try {
      const items = normalizeFleetSyncPayload(payload);
      const timestamp = this.now().toISOString();
      const events = buildFleetTelemetryEvents(items, {
        installId: this.installId,
        sessionId: this.sessionId,
        sidecarVersion: this.sidecarVersion,
        timestamp,
        nextSequence: () => {
          this.sequence += 1;
          return this.sequence;
        },
      });
      return await this.appendTelemetryEvents(events, items.length);
    } catch (error) {
      this.lastError = summarizeFleetBrokerError(error);
      this.lastErrorAt = this.now().toISOString();
      throw error;
    }
  }

  async ingestFleetRuntimePayload(payload: unknown): Promise<FleetBrokerIngestResult> {
    try {
      const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
      const events = buildFleetRuntimeTelemetryEvents(envelopes, {
        installId: this.installId,
        sidecarVersion: this.sidecarVersion,
      });
      return await this.appendTelemetryEvents(events, envelopes.length);
    } catch (error) {
      this.lastError = summarizeFleetBrokerError(error);
      this.lastErrorAt = this.now().toISOString();
      throw error;
    }
  }

  async readProjection(): Promise<FleetBrokerReadProjectionResult> {
    try {
      const projection = await this.store.readProjection(`fleet:${this.installId}`);
      this.lastError = null;
      return {
        ok: true,
        available: projection !== null,
        generatedAt: this.now().toISOString(),
        cloudUploadEnabled: this.cloudUploadEnabled,
        projection: projection ? {
          projectionKey: projection.projectionKey,
          installId: projection.installId,
          sessionId: projection.sessionId,
          stateVersion: projection.stateVersion,
          stateHash: projection.stateHash,
          observedAt: projection.observedAt,
          updatedAt: projection.updatedAt,
          slotCount: projection.slotCount,
          slots: projection.slots,
        } : null,
      };
    } catch (error) {
      this.lastError = summarizeFleetBrokerError(error);
      this.lastErrorAt = this.now().toISOString();
      throw error;
    }
  }

  async listPendingOutbox(limit = 100): Promise<FleetOutboxEntry[]> {
    return this.store.listPendingOutbox(limit);
  }

  async status(): Promise<FleetBrokerStatusSummary> {
    try {
      const summary = await this.store.readSummary();
      this.lastError = this.lastError;
      return {
        available: true,
        cloudUploadEnabled: this.cloudUploadEnabled,
        lastError: this.lastError,
        lastErrorAt: this.lastErrorAt,
        ...summary,
      };
    } catch (error) {
      this.lastError = summarizeFleetBrokerError(error);
      this.lastErrorAt = this.now().toISOString();
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  private async appendTelemetryEvents(
    events: ReadonlyArray<FleetTelemetryEvent>,
    received: number,
  ): Promise<FleetBrokerIngestResult> {
    if (events.length === 0) {
      this.lastError = null;
      return {
        ok: true,
        protocolVersion: SIDECAR_TELEMETRY_PROTOCOL_VERSION,
        received,
        accepted: 0,
        cloudUploadEnabled: this.cloudUploadEnabled,
        rawStored: 0,
        duplicates: 0,
        outboxInserted: 0,
        outboxUpdated: 0,
        projectionAdvanced: 0,
        projectionNoOp: 0,
        projectionStale: 0,
      };
    }

    const result = await this.store.append(events);
    const { received: _ignoredReceived, ...storeResult } = result;
    this.lastError = null;
    return {
      ok: true,
      protocolVersion: SIDECAR_TELEMETRY_PROTOCOL_VERSION,
      received,
      accepted: events.length,
      cloudUploadEnabled: this.cloudUploadEnabled,
      ...storeResult,
    };
  }
}

export { summarizeFleetBrokerError };