import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSqlFleetBrokerStore,
  type FleetProjectionRecord,
} from "./sql-broker-store.js";
import {
  FLEET_SNAPSHOT_SCHEMA_VERSION,
  FLEET_SLOT_CHANGED_SCHEMA_VERSION,
  SIDECAR_TELEMETRY_PROTOCOL_VERSION,
  type FleetSnapshotEvent,
  type FleetSlotChangedEvent,
} from "./fleet-telemetry.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("sql fleet broker store", () => {
  it("initializes broker schema with empty counts", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    expect(await store.readSummary()).toMatchObject({
      backend: "sqlite",
      rawEventCount: 0,
      pendingOutboxCount: 0,
      projectionCount: 0,
      latestSequence: 0,
      lastObservedAt: null,
      lastProjectedAt: null,
    });
    expect(await store.readProjection()).toBeNull();
    expect(await store.listPendingOutbox()).toEqual([]);

    await store.close();
  });

  it("writes raw ledger, outbox, and projection rows on ingest", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    const result = await store.append([
      snapshotEvent({
        idempotencyKey: "snapshot-1",
        snapshotVersion: 1,
      }),
    ]);
    const summary = await store.readSummary();
    const projection = await store.readProjection("fleet:install-test");
    const outbox = await store.listPendingOutbox();

    expect(result).toEqual({
      received: 1,
      rawStored: 1,
      duplicates: 0,
      outboxInserted: 1,
      outboxUpdated: 0,
      projectionAdvanced: 1,
      projectionNoOp: 0,
      projectionStale: 0,
    });
    expect(summary).toMatchObject({
      rawEventCount: 1,
      pendingOutboxCount: 1,
      projectionCount: 1,
      latestSequence: 1,
    });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.idempotencyKey).toBe("snapshot-1");
    expect(projection).not.toBeNull();
    expect(projection).toMatchObject({
      projectionKey: "fleet:install-test",
      stateVersion: 1,
      slotCount: 1,
    });

    await store.close();
  });

  it("deduplicates by idempotency across store reopen", async () => {
    const connection = makeTempPath("fleet-broker.sqlite");
    const firstStore = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection,
    });
    const event = snapshotEvent({ idempotencyKey: "snapshot-reopen-1", snapshotVersion: 1 });

    expect(await firstStore.append([event])).toMatchObject({ rawStored: 1, duplicates: 0 });
    await firstStore.close();

    const secondStore = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection,
    });
    expect(await secondStore.append([event])).toMatchObject({ rawStored: 0, duplicates: 1 });
    expect(await secondStore.readSummary()).toMatchObject({
      rawEventCount: 1,
      pendingOutboxCount: 1,
      projectionCount: 1,
      latestSequence: 1,
    });

    await secondStore.close();
  });

  it("coalesces pending outbox work to the latest pending state", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    await store.append([
      snapshotEvent({
        idempotencyKey: "snapshot-1",
        snapshotVersion: 1,
        slots: [projectionSlot({ slotKey: "ship-alpha", shipKeyHash: "aaaa", levelBand: "20-29" })],
      }),
    ]);
    await store.append([
      snapshotEvent({
        idempotencyKey: "snapshot-2",
        snapshotVersion: 2,
        timestamp: "2026-05-18T12:01:00.000Z",
        observedAt: "2026-05-18T12:01:00.000Z",
        snapshotId: "snapshot-2",
        slots: [projectionSlot({ slotKey: "ship-beta", shipKeyHash: "bbbb", levelBand: "30-39" })],
      }),
    ]);

    const outbox = await store.listPendingOutbox();
    const projection = await store.readProjection("fleet:install-test");

    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.idempotencyKey).toBe("snapshot-2");
    expect(outbox[0]?.payloadJson).toContain("ship-beta");
    expect(projection).toMatchObject({ stateVersion: 2, slotCount: 1 });
    expect(projection?.slots[0]?.slotKey).toBe("ship-beta");

    await store.close();
  });

  it("treats same-state snapshots as projection no-ops without extra pending work", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    const first = await store.append([
      snapshotEvent({ idempotencyKey: "snapshot-1", snapshotVersion: 1 }),
    ]);
    const second = await store.append([
      snapshotEvent({
        idempotencyKey: "snapshot-2",
        snapshotVersion: 2,
        timestamp: "2026-05-18T12:01:00.000Z",
        observedAt: "2026-05-18T12:01:00.000Z",
        snapshotId: "snapshot-2",
      }),
    ]);
    const projection = await store.readProjection("fleet:install-test");
    const summary = await store.readSummary();

    expect(first).toMatchObject({ projectionAdvanced: 1, outboxInserted: 1 });
    expect(second).toMatchObject({ projectionNoOp: 1, outboxInserted: 0, outboxUpdated: 0 });
    expect(summary).toMatchObject({ rawEventCount: 2, pendingOutboxCount: 1, projectionCount: 1 });
    expect(projection).toMatchObject({ stateVersion: 1 });

    await store.close();
  });

  it("advances projection on newer state and blocks stale regression", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    await store.append([
      snapshotEvent({ idempotencyKey: "snapshot-1", snapshotVersion: 1 }),
    ]);
    const newer = await store.append([
      slotChangedEvent({
        idempotencyKey: "slot-2",
        stateVersion: 2,
        currentState: "assigned",
        slotKey: "slot-alpha",
        fleetKey: "fleet-alpha",
      }),
    ]);
    const stale = await store.append([
      slotChangedEvent({
        idempotencyKey: "slot-1",
        stateVersion: 1,
        currentState: "empty",
        slotKey: "slot-alpha",
        fleetKey: "fleet-alpha",
        timestamp: "2026-05-18T11:59:00.000Z",
        observedAt: "2026-05-18T11:59:00.000Z",
      }),
    ]);
    const projection = await store.readProjection("fleet:install-test");

    expect(newer).toMatchObject({ projectionAdvanced: 1 });
    expect(stale).toMatchObject({ projectionStale: 1, outboxInserted: 0, outboxUpdated: 0 });
    expect(projection).toMatchObject({ stateVersion: 2 });
    expect(findProjectionSlot(projection, "slot-alpha")?.state).toBe("assigned");

    await store.close();
  });

  it("allows a different session with lower version to advance changed install-scoped projection", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    await store.append([
      snapshotEvent({
        idempotencyKey: "session-a-10",
        sessionId: "session-a",
        snapshotVersion: 10,
        snapshotId: "session-a-10",
      }),
    ]);
    const changedSession = await store.append([
      snapshotEvent({
        idempotencyKey: "session-b-1",
        sessionId: "session-b",
        snapshotVersion: 1,
        snapshotId: "session-b-1",
        timestamp: "2026-05-18T12:05:00.000Z",
        observedAt: "2026-05-18T12:05:00.000Z",
        slots: [projectionSlot({ slotKey: "ship-beta", shipKeyHash: "bbbb", levelBand: "30-39" })],
      }),
    ]);
    const projection = await store.readProjection("fleet:install-test");

    expect(changedSession).toMatchObject({ projectionAdvanced: 1, projectionStale: 0 });
    expect(projection).toMatchObject({ sessionId: "session-b", stateVersion: 1, slotCount: 1 });
    expect(projection?.slots[0]?.slotKey).toBe("ship-beta");

    await store.close();
  });

  it("keeps same-session lower version stale and non-regressing", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    await store.append([
      snapshotEvent({
        idempotencyKey: "session-a-10",
        sessionId: "session-a",
        snapshotVersion: 10,
        snapshotId: "session-a-10",
      }),
    ]);
    const stale = await store.append([
      snapshotEvent({
        idempotencyKey: "session-a-9",
        sessionId: "session-a",
        snapshotVersion: 9,
        snapshotId: "session-a-9",
        timestamp: "2026-05-18T12:06:00.000Z",
        observedAt: "2026-05-18T12:06:00.000Z",
        slots: [projectionSlot({ slotKey: "ship-beta", shipKeyHash: "bbbb", levelBand: "30-39" })],
      }),
    ]);
    const projection = await store.readProjection("fleet:install-test");

    expect(stale).toMatchObject({ projectionStale: 1, projectionAdvanced: 0, outboxInserted: 0, outboxUpdated: 0 });
    expect(projection).toMatchObject({ sessionId: "session-a", stateVersion: 10, slotCount: 1 });
    expect(projection?.slots[0]?.slotKey).toBe("ship-alpha");

    await store.close();
  });

  it("reads the current projection state directly", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });

    await store.append([
      snapshotEvent({
        idempotencyKey: "snapshot-1",
        snapshotVersion: 1,
        slots: [
          projectionSlot({ slotKey: "ship-alpha", shipKeyHash: "aaaa", levelBand: "20-29" }),
          projectionSlot({ slotKey: "ship-beta", shipKeyHash: "bbbb", levelBand: "30-39" }),
        ],
        fleetCount: 2,
      }),
    ]);

    const projection = await store.readProjection("fleet:install-test");
    expect(projection).toMatchObject({
      projectionKey: "fleet:install-test",
      slotCount: 2,
      stateVersion: 1,
    });
    expect(projection?.slots.map((slot) => slot.slotKey)).toEqual(["ship-alpha", "ship-beta"]);

    await store.close();
  });
});

function makeTempPath(fileName: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stfc-fleet-broker-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

function projectionSlot(overrides: Partial<FleetSnapshotEvent["slots"][number]> = {}): FleetSnapshotEvent["slots"][number] {
  return {
    slotKey: "ship-alpha",
    fleetKey: "fleet-alpha",
    shipKeyHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: "observed",
    assignmentKind: "player_ship",
    updatedAt: "2026-05-18T12:00:00.000Z",
    shipType: "hull:9191",
    levelBand: "20-29",
    healthBand: "tier:6",
    ...overrides,
  };
}

function snapshotEvent(overrides: Partial<FleetSnapshotEvent> = {}): FleetSnapshotEvent {
  return {
    protocolVersion: SIDECAR_TELEMETRY_PROTOCOL_VERSION,
    schemaVersion: FLEET_SNAPSHOT_SCHEMA_VERSION,
    type: "fleet.snapshot",
    timestamp: "2026-05-18T12:00:00.000Z",
    installId: "install-test",
    sessionId: "session-test",
    source: "stfc-sidecar",
    classification: "cloud_private",
    idempotencyKey: "snapshot-1",
    snapshotId: "snapshot-1",
    snapshotVersion: 1,
    observedAt: "2026-05-18T12:00:00.000Z",
    sidecarVersion: "0.1.0-test",
    fleetCount: 1,
    slots: [projectionSlot()],
    capabilities: { fleetProjection: true, battleSummary: true },
    coalesceKey: "install-test:fleet.snapshot:session-test",
    ...overrides,
  };
}

function slotChangedEvent(overrides: Partial<FleetSlotChangedEvent> = {}): FleetSlotChangedEvent {
  return {
    protocolVersion: SIDECAR_TELEMETRY_PROTOCOL_VERSION,
    schemaVersion: FLEET_SLOT_CHANGED_SCHEMA_VERSION,
    type: "fleet.slot.changed",
    timestamp: "2026-05-18T12:00:30.000Z",
    installId: "install-test",
    sessionId: "session-test",
    source: "stfc-sidecar",
    classification: "cloud_private",
    idempotencyKey: "slot-1",
    slotKey: "slot-alpha",
    fleetKey: "fleet-alpha",
    currentState: "assigned",
    assignmentKind: "slot-type:2",
    observedAt: "2026-05-18T12:00:30.000Z",
    stateVersion: 2,
    coalesceKey: "install-test:fleet.slot:slot-alpha",
    ...overrides,
  };
}

function findProjectionSlot(projection: FleetProjectionRecord | null, slotKey: string) {
  return projection?.slots.find((slot) => slot.slotKey === slotKey) ?? null;
}