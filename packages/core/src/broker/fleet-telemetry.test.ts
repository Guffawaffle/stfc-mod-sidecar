import { describe, expect, it } from "vitest";

import {
  buildFleetRuntimeTelemetryEvents,
  countFleetRuntimeMajelEnvelopes,
  extractFleetRuntimeMajelEnvelopes,
} from "./fleet-telemetry.js";

describe("fleet runtime telemetry conversion", () => {
  it("converts allowlisted runtime snapshot fields into a broker snapshot", () => {
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
          { slotIndex: 1, present: true, fleetId: 4002, currentStateName: "Mining", hullName: "North Star", token: "nope" },
          { slotIndex: 2, present: false, coordinates: { x: 4, y: 7 } },
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
      fleetCount: 2,
    });
    expect(events[0].slots).toEqual([
      expect.objectContaining({ slotKey: "slot-0", assignmentKind: "player_ship", state: "docked", shipType: "hull:Enterprise" }),
      expect.objectContaining({ slotKey: "slot-1", assignmentKind: "player_ship", state: "mining", shipType: "hull:North Star" }),
      expect.objectContaining({ slotKey: "slot-2", assignmentKind: "slot", state: "empty" }),
    ]);
    expect(events[0].slots[1]).not.toHaveProperty("token");
    expect(events[0].slots[2]).not.toHaveProperty("coordinates");
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