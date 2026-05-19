import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFleetTelemetryBroker } from "./fleet-broker.js";
import { summarizeFleetBrokerError } from "./error-summary.js";
import { createSqlFleetBrokerStore } from "./sql-broker-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("fleet telemetry broker", () => {
  it("keeps local projection usable when cloud upload is disabled", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-broker.sqlite"),
    });
    const broker = await createFleetTelemetryBroker({
      store,
      installId: "install-test",
      sessionId: "session-test",
      sidecarVersion: "0.1.0-test",
      cloudUploadEnabled: false,
      now: fixedClock("2026-05-18T12:00:00.000Z"),
    });

    const ingest = await broker.ingestSyncPayload([
      { type: "ship", psid: 12345, hull_id: 9191, level: 34, tier: 6 },
      { type: "slot", sid: 22, slot_type: 2, item_id: 9001 },
    ]);
    const projection = await broker.readProjection();
    const status = await broker.status();
    const outbox = await broker.listPendingOutbox();

    expect(ingest).toMatchObject({
      ok: true,
      received: 2,
      accepted: 2,
      cloudUploadEnabled: false,
      rawStored: 2,
      duplicates: 0,
      projectionAdvanced: 2,
    });
    expect(projection).toMatchObject({
      ok: true,
      available: true,
      cloudUploadEnabled: false,
    });
    expect(projection.projection?.slotCount).toBe(2);
    expect(status).toMatchObject({
      available: true,
      cloudUploadEnabled: false,
      rawEventCount: 2,
      pendingOutboxCount: 2,
      projectionCount: 1,
    });
    expect(outbox).toHaveLength(2);
    expect("payloadJson" in status).toBe(false);
    expect("authorization" in status).toBe(false);
    expect("syncToken" in status).toBe(false);

    await broker.close();
  });

  it("summarizes broker errors with truncation and redaction", () => {
    const summary = summarizeFleetBrokerError(
      "authorization: Bearer secret-token cookie=session-cookie syncToken=abc123 token=xyz payload_json={\"secret\":true} request body={\"token\":\"abc\"} response body={\"cookie\":\"value\"} "
      + "x".repeat(400),
    );

    expect(summary).not.toContain("secret-token");
    expect(summary).not.toContain("session-cookie");
    expect(summary).not.toContain("abc123");
    expect(summary).not.toContain("payload_json={");
    expect(summary).not.toContain("request body={");
    expect(summary).not.toContain("response body={");
    expect(summary.length).toBeLessThanOrEqual(240);
  });

  it("bridges newer Majel runtime snapshots into the local projection without leaking raw fields", async () => {
    const store = await createSqlFleetBrokerStore({
      backend: "sqlite",
      connection: makeTempPath("fleet-runtime-broker.sqlite"),
    });
    const broker = await createFleetTelemetryBroker({
      store,
      installId: "install-test",
      sessionId: "viewer-session",
      sidecarVersion: "0.1.0-test",
      cloudUploadEnabled: false,
      now: fixedClock("2026-05-18T12:00:00.000Z"),
    });

    await broker.ingestSyncPayload([
      { type: "ship", psid: 12345, hull_id: 9191, level: 34, tier: 6 },
      { type: "slot", sid: 22, slot_type: 2, item_id: 9001 },
    ]);

    const ingest = await broker.ingestFleetRuntimePayload(runtimeEnvelope({
      sessionId: "mod-session-1",
      sequence: 17,
      observedAt: "2026-05-18T12:05:00.000Z",
    }));
    const projection = await broker.readProjection();

    expect(ingest).toMatchObject({
      ok: true,
      received: 1,
      accepted: 1,
      rawStored: 1,
      projectionAdvanced: 1,
      projectionStale: 0,
      cloudUploadEnabled: false,
    });
    expect(projection.projection).toMatchObject({
      installId: "install-test",
      sessionId: "mod-session-1",
      stateVersion: 17,
      slotCount: 10,
      updatedAt: "2026-05-18T12:05:00.000Z",
    });

    const slots = projection.projection?.slots ?? [];
    expect(slots.filter((slot) => slot.state === "docked")).toHaveLength(5);
    expect(slots.filter((slot) => slot.state === "mining")).toHaveLength(1);
    expect(slots.filter((slot) => slot.state === "warping")).toHaveLength(1);
    expect(slots.filter((slot) => slot.state === "empty")).toHaveLength(3);
    expect(slots.find((slot) => slot.slotKey === "slot-3")).toMatchObject({
      assignmentKind: "player_ship",
      state: "warping",
      shipType: "hull:Discovery",
    });
    expect(slots[0]).not.toHaveProperty("token");
    expect(slots[0]).not.toHaveProperty("rawJson");
    expect(slots[0]).not.toHaveProperty("coordinates");

    await broker.close();
  });
});

function makeTempPath(fileName: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stfc-fleet-broker-"));
  tempDirs.push(dir);
  return path.join(dir, fileName);
}

function fixedClock(value: string) {
  return () => new Date(value);
}

function runtimeEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "majel.ingest.v1",
    eventId: "runtime-event-1",
    source: "stfc-community-mod",
    sourceVersion: "2.0.1-test",
    installId: "not_configured",
    sessionId: "mod-session-1",
    sequence: 17,
    observedAt: "2026-05-18T12:05:00.000Z",
    schema: "stfc.fleet.runtime_snapshot.v1",
    classification: "cloud_private",
    payload: {
      type: "fleet.runtime",
      schemaVersion: "stfc.fleet.runtime_snapshot.v1",
      source: "deployment-battle-end-event",
      observedAtMs: 1747569900000,
      fleetBarTracked: true,
      selectedIndex: 3,
      slots: [
        { slotIndex: 0, present: true, fleetId: 1000, currentStateName: "Docked", hullName: "Enterprise", token: "secret" },
        { slotIndex: 1, present: true, fleetId: 1001, currentStateName: "Docked", hullName: "Defiant" },
        { slotIndex: 2, present: true, fleetId: 1002, currentStateName: "Docked", hullName: "Voyager" },
        { slotIndex: 3, present: true, fleetId: 1003, currentStateName: "Warping", hullName: "Discovery", coordinates: { x: 1, y: 2 } },
        { slotIndex: 4, present: true, fleetId: 1004, currentStateName: "Docked", hullName: "Franklin" },
        { slotIndex: 5, present: true, fleetId: 1005, currentStateName: "Docked", hullName: "Meridian" },
        { slotIndex: 6, present: true, fleetId: 1006, currentStateName: "Mining", hullName: "Botany Bay" },
        { slotIndex: 7, present: false },
        { slotIndex: 8, present: false },
        { slotIndex: 9, present: false },
      ],
    },
    ...overrides,
  };
}