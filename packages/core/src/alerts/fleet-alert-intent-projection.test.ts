import { describe, expect, it } from "vitest";

import {
  buildFleetAlertIntentProjectionFromStoredEvents,
  FLEET_ALERT_INTENT_PROJECTION_SCHEMA_VERSION,
  type FleetAlertStoredEventInput,
} from "./fleet-alert-intent-projection.js";
import {
  FLEET_ALERT_EVIDENCE_SCHEMA_VERSION,
  SIDECAR_EVENT_PROTOCOL_VERSION,
  type DebugEvent,
  type FleetAlertEvidenceEvent,
} from "../events/types.js";

describe("fleet alert intent projection", () => {
  it("derives provider-neutral intents from stored fleet alert evidence records", () => {
    const projection = buildFleetAlertIntentProjectionFromStoredEvents([
      storedEvent(101, "fleet-alert-arrival", sampleArrivalEvidence()),
      storedEvent(102, "fleet-alert-incoming", sampleIncomingAttackEvidence()),
    ], { generatedAt: "2026-06-14T04:00:00.000Z" });

    expect(projection).toMatchObject({
      schemaVersion: FLEET_ALERT_INTENT_PROJECTION_SCHEMA_VERSION,
      generatedAt: "2026-06-14T04:00:00.000Z",
      sourceEventCount: 2,
      intentCount: 2,
      skippedCount: 0,
      skipped: [],
    });
    expect(projection.items.map((item) => item.sequenceId)).toEqual([101, 102]);
    expect(projection.items.map((item) => item.eventKey)).toEqual(["fleet-alert-arrival", "fleet-alert-incoming"]);
    expect(projection.items.map((item) => item.intent.kind)).toEqual(["fleet_arrival", "fleet_incoming_attack"]);
  });

  it("preserves stored identity, string ids, and missing evidence in projected intents", () => {
    const projection = buildFleetAlertIntentProjectionFromStoredEvents([
      storedEvent(201, "fleet-alert-arrival", sampleArrivalEvidence()),
      storedEvent(202, "fleet-alert-incoming", sampleIncomingAttackEvidence({
        missingEvidence: ["systemId", "resolvedFleetId"],
      })),
    ]);

    const arrival = projection.items[0]?.intent;
    const incoming = projection.items[1]?.intent;

    expect(arrival?.fleet?.fleetId).toBe("12345678901234567890");
    expect(arrival?.ship?.shipId).toBe("9876543210987654321");
    expect(arrival?.missingEvidence).toEqual(["systemId"]);
    expect(incoming?.target?.fleetId).toBe("4001");
    expect(incoming?.attacker?.identity).toBe("9876543210987654321");
    expect(incoming?.missingEvidence).toEqual(["systemId", "resolvedFleetId"]);
    expect(incoming?.location).toBeUndefined();
  });

  it("tracks skipped records without treating expected evidence gaps as errors", () => {
    const projection = buildFleetAlertIntentProjectionFromStoredEvents([
      storedEvent(301, "debug-1", sampleDebugEvent()),
      storedEvent(302, "fleet-alert-unsupported", sampleArrivalEvidence({
        eventType: "fleet.started_mining",
        missingEvidence: ["systemId"],
      })),
      storedEvent(303, "fleet-alert-incoming", sampleIncomingAttackEvidence({
        missingEvidence: ["systemId"],
        location: undefined,
      })),
    ]);

    expect(projection.sourceEventCount).toBe(3);
    expect(projection.intentCount).toBe(1);
    expect(projection.skippedCount).toBe(2);
    expect(projection.skipped).toEqual([
      {
        sequenceId: 301,
        eventKey: "debug-1",
        eventType: "debug.event",
        reason: "not_fleet_alert_evidence",
      },
      {
        sequenceId: 302,
        eventKey: "fleet-alert-unsupported",
        eventType: "fleet.started_mining",
        reason: "unsupported_fleet_alert_event_type",
      },
    ]);
    expect(projection.items[0]?.intent.missingEvidence).toEqual(["systemId"]);
    expect(projection.items[0]?.intent.location).toBeUndefined();
  });
});

function storedEvent(
  sequenceId: number,
  eventKey: string,
  event: FleetAlertEvidenceEvent | DebugEvent,
): FleetAlertStoredEventInput {
  return { sequenceId, eventKey, event };
}

function sampleArrivalEvidence(overrides: Partial<FleetAlertEvidenceEvent> = {}): FleetAlertEvidenceEvent {
  return {
    protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
    type: "fleet.alert_evidence",
    schemaVersion: FLEET_ALERT_EVIDENCE_SCHEMA_VERSION,
    timestamp: "2026-06-11T12:34:56.000Z",
    source: "stfc-community-mod",
    capturedAtUnixMs: 1781181296000,
    observedAtUnixMs: 1781181296000,
    eventType: "fleet.arrived_in_system",
    dispatch: {
      source: "fleet-slot-arrived-in-system",
      owner: "FleetArrivalHooks",
      seam: "Digit.Prime.HUD.FleetStateWidget.SetWidgetData",
      reason: "fleet-slot-arrived-in-system",
      effect: "publish-fleet-alert-evidence",
    },
    fleet: {
      fleetId: "12345678901234567890",
      slotIndex: 2,
      state: {
        previous: 256,
        previousName: "Warping",
        current: 512,
        currentName: "Impulsing",
      },
    },
    ship: {
      shipId: "9876543210987654321",
      hullSpecId: "1307832955",
      displayName: "Squall",
      hullName: "USS Enterprise",
    },
    missingEvidence: ["systemId"],
    ...overrides,
  };
}

function sampleIncomingAttackEvidence(overrides: Partial<FleetAlertEvidenceEvent> = {}): FleetAlertEvidenceEvent {
  return {
    protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
    type: "fleet.alert_evidence",
    schemaVersion: FLEET_ALERT_EVIDENCE_SCHEMA_VERSION,
    timestamp: "2026-06-11T12:35:10.000Z",
    source: "stfc-community-mod",
    capturedAtUnixMs: 1781181310000,
    observedAtUnixMs: 1781181310000,
    eventType: "fleet.incoming_attack",
    dispatch: {
      source: "toast-fleet-queue",
      owner: "FleetArrivalHooks",
      seam: "Digit.Prime.HUD.ToastFleetObserver.QueueNotifications",
      reason: "incoming-attack-materialized",
      effect: "publish-fleet-alert-evidence",
    },
    target: {
      targetType: 1,
      targetTypeName: "Fleet",
      fleetId: "4001",
    },
    fleet: {
      fleetId: "4001",
      state: {
        current: 512,
        currentName: "Impulsing",
      },
      shipDisplayName: "Squall",
    },
    attacker: {
      fleetType: 2,
      kind: "Hostile",
      identity: "9876543210987654321",
    },
    missingEvidence: ["systemId"],
    ...overrides,
  };
}

function sampleDebugEvent(): DebugEvent {
  return {
    protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
    type: "debug.event",
    timestamp: "2026-06-11T12:36:00.000Z",
    source: "test",
    level: "info",
    message: "not fleet alert evidence",
  };
}
