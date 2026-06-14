import { describe, expect, it } from "vitest";

import {
  buildFleetRuntimeTelemetryEvents,
  countFleetRuntimeMajelEnvelopes,
  extractFleetRuntimeMajelEnvelopes,
} from "./fleet-telemetry.js";

describe("fleet runtime telemetry conversion", () => {
  it("accepts runtime snapshots with no hullSpecId", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "deployment-battle-end-event",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          { slotIndex: 0, present: true, fleetId: 4001, currentStateName: "Docked", hullName: "Enterprise" },
          { slotIndex: 1, present: false, coordinates: { x: 4, y: 7 } },
        ],
      },
    });

    expect(countFleetRuntimeMajelEnvelopes(payload)).toBe(1);

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
    const events = buildFleetRuntimeTelemetryEvents(envelopes, {
      installId: "install-test",
      sidecarVersion: "0.1.0-test",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "fleet.snapshot",
      installId: "install-test",
      sessionId: "mod-session-1",
      snapshotVersion: 17,
      observedAt: "2026-05-18T12:05:00.000Z",
      fleetCount: 1,
    });
    expect(events[0].slots).toEqual([
      expect.objectContaining({ slotKey: "slot-0", assignmentKind: "player_ship", state: "docked", shipType: "hull:Enterprise" }),
      expect.objectContaining({ slotKey: "slot-1", assignmentKind: "slot", state: "empty" }),
    ]);
    expect(events[0].slots[0]).not.toHaveProperty("hullSpecId");
    expect(events[0].slots[1]).not.toHaveProperty("coordinates");
  });

  it("preserves numeric hullSpecId from runtime snapshots", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "deployment-battle-end-event",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          { slotIndex: 0, present: true, fleetId: 4001, currentStateName: "Docked", hullName: "USS Reliant", hullSpecId: 1328894295, token: "nope" },
        ],
      },
    });

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
    const events = buildFleetRuntimeTelemetryEvents(envelopes, {
      installId: "install-test",
      sidecarVersion: "0.1.0-test",
    });

    expect(events[0].slots).toEqual([
      expect.objectContaining({
        slotKey: "slot-0",
        assignmentKind: "player_ship",
        state: "docked",
        shipType: "hull:USS Reliant",
        hullSpecId: 1328894295,
      }),
    ]);
    expect(events[0].slots[0]).not.toHaveProperty("token");
  });

  it("normalizes invalid hullSpecId values away", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "deployment-battle-end-event",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          { slotIndex: 0, present: true, fleetId: 4001, currentStateName: "Docked", hullName: "USS Reliant", hullSpecId: "1328894295x" },
        ],
      },
    });

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
    const events = buildFleetRuntimeTelemetryEvents(envelopes, {
      installId: "install-test",
      sidecarVersion: "0.1.0-test",
    });

    expect(events[0].slots).toEqual([
      expect.objectContaining({
        slotKey: "slot-0",
        assignmentKind: "player_ship",
        state: "docked",
        shipType: "hull:USS Reliant",
      }),
    ]);
    expect(events[0].slots[0]).not.toHaveProperty("hullSpecId");
  });

  it("accepts runtime snapshots without a ship identity probe", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "fleet-slot-combat-started",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          { slotIndex: 0, present: true, fleetId: 4001, currentStateName: "Docked", hullName: "Enterprise" },
        ],
      },
    });

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.payload.slots[0]).not.toHaveProperty("shipIdentityProbe");
  });

  it("preserves string ship identity probe fields in raw Majel payloads", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "fleet-slot-combat-started",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          {
            slotIndex: 0,
            present: true,
            fleetId: 4001,
            currentStateName: "Docked",
            hullName: "Enterprise",
            shipIdentityProbe: {
              shipId: "2679690622826529803",
              source: "FleetPlayerData.Ship.ID",
            },
          },
        ],
      },
    });

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
    const slot = envelopes[0]?.payload.slots[0];

    expect(envelopes).toHaveLength(1);
    expect(slot).toMatchObject({
      shipIdentityProbe: {
        shipId: "2679690622826529803",
        source: "FleetPlayerData.Ship.ID",
      },
    });
  });

  it("projects exact string ship identity ids onto runtime fleet rows", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "fleet-slot-combat-started",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          {
            slotIndex: 0,
            present: true,
            fleetId: 4001,
            currentStateName: "Docked",
            hullName: "Enterprise",
            shipIdentityProbe: {
              shipId: "2679690622826529803",
              source: "FleetPlayerData.Ship.ID",
            },
          },
        ],
      },
    });

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
    const events = buildFleetRuntimeTelemetryEvents(envelopes, {
      installId: "install-test",
      sidecarVersion: "0.1.0-test",
    });

    expect(events[0]?.slots[0]).toMatchObject({
      shipIdentityId: "2679690622826529803",
    });
  });

  it("projects active timer observations onto runtime fleet rows", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "fleet-slot-warping",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          {
            slotIndex: 0,
            present: true,
            fleetId: 4001,
            currentStateName: "Warping",
            hullName: "Enterprise",
            activeTimer: {
              remainingTicks: 905000000,
              remainingMs: 90500,
              remainingSeconds: 90.5,
              source: "FleetPlayerData.Timer.RemainingTime",
            },
          },
        ],
      },
    });

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
    const events = buildFleetRuntimeTelemetryEvents(envelopes, {
      installId: "install-test",
      sidecarVersion: "0.1.0-test",
    });

    expect(events[0]?.slots[0]).toMatchObject({
      state: "warping",
      activeTimerRemainingMs: 90500,
      activeTimerSource: "FleetPlayerData.Timer.RemainingTime",
    });
  });

  it("does not trust numeric ship identity probe fields for projection", () => {
    const payload = runtimeEnvelope({
      payload: {
        type: "fleet.runtime",
        schemaVersion: "stfc.fleet.runtime_snapshot.v1",
        source: "fleet-slot-combat-started",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 2,
        slots: [
          {
            slotIndex: 0,
            present: true,
            fleetId: 4001,
            currentStateName: "Docked",
            hullName: "Enterprise",
            shipIdentityProbe: {
              shipId: 2679690622826529803,
              source: "FleetPlayerData.Ship.ID",
            },
          },
        ],
      },
    });

    const envelopes = extractFleetRuntimeMajelEnvelopes(payload);
    const events = buildFleetRuntimeTelemetryEvents(envelopes, {
      installId: "install-test",
      sidecarVersion: "0.1.0-test",
    });

    expect(envelopes[0]?.payload.slots[0]).toMatchObject({
      shipIdentityProbe: {
        shipId: 2679690622826529803,
        source: "FleetPlayerData.Ship.ID",
      },
    });
    expect(events[0]?.slots[0]).not.toHaveProperty("shipIdentityId");
  });
});

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
      slots: [],
    },
    ...overrides,
  };
}
