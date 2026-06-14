import { describe, expect, it } from "vitest";

import {
  buildFleetAlertIntentFromEvidence,
  buildFleetAlertIntentsFromEvidence,
  FLEET_ALERT_INTENT_SCHEMA_VERSION,
  FLEET_ALERT_INTENT_TYPE,
} from "./fleet-alert-intents.js";
import {
  FLEET_ALERT_EVIDENCE_SCHEMA_VERSION,
  SIDECAR_EVENT_PROTOCOL_VERSION,
  type FleetAlertEvidenceEvent,
} from "../events/types.js";

describe("fleet alert intents", () => {
  it("converts fleet arrival evidence into a provider-neutral intent", () => {
    const evidence = sampleArrivalEvidence();
    const intent = buildFleetAlertIntentFromEvidence(evidence);

    expect(intent).toMatchObject({
      type: FLEET_ALERT_INTENT_TYPE,
      schemaVersion: FLEET_ALERT_INTENT_SCHEMA_VERSION,
      kind: "fleet_arrival",
      eventType: "fleet.arrived_in_system",
      timestamp: "2026-06-11T12:34:56.000Z",
      observedAtUnixMs: 1781181296000,
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
      evidence: {
        type: "fleet.alert_evidence",
        schemaVersion: FLEET_ALERT_EVIDENCE_SCHEMA_VERSION,
        eventType: "fleet.arrived_in_system",
        dispatch: {
          owner: "FleetArrivalHooks",
          reason: "fleet-slot-arrived-in-system",
          effect: "publish-fleet-alert-evidence",
        },
      },
      missingEvidence: ["systemId"],
    });
    expect(intent?.location).toBeUndefined();
    expect(intent).not.toHaveProperty("providers");
    expect(intent).not.toHaveProperty("title");
    expect(intent).not.toHaveProperty("body");
  });

  it("converts incoming attack evidence into a provider-neutral intent", () => {
    const evidence = sampleIncomingAttackEvidence();
    const intent = buildFleetAlertIntentFromEvidence(evidence);

    expect(intent).toMatchObject({
      kind: "fleet_incoming_attack",
      eventType: "fleet.incoming_attack",
      fleet: {
        fleetId: "4001",
        shipDisplayName: "Squall",
        state: {
          current: 512,
          currentName: "Impulsing",
        },
      },
      target: {
        fleetId: "4001",
        targetType: 1,
        targetTypeName: "Fleet",
      },
      attacker: {
        fleetType: 2,
        kind: "Hostile",
        identity: "9876543210987654321",
      },
      missingEvidence: ["systemId", "targetShipDisplayName"],
    });
    expect(intent?.ship).toBeUndefined();
    expect(intent).not.toHaveProperty("provider");
    expect(intent).not.toHaveProperty("fulfillment");
  });

  it("preserves large identifiers as strings in facts and dedupe fields", () => {
    const intent = buildFleetAlertIntentFromEvidence(sampleArrivalEvidence());

    expect(typeof intent?.fleet?.fleetId).toBe("string");
    expect(intent?.fleet?.fleetId).toBe("12345678901234567890");
    expect(typeof intent?.ship?.shipId).toBe("string");
    expect(intent?.ship?.shipId).toBe("9876543210987654321");
    expect(intent?.dedupeKey).toContain("fleetId=12345678901234567890");
    expect(intent?.intentId).toMatch(/^fleet-alert-intent:[a-f0-9]{24}$/);
  });

  it("uses stable intent identity for the same evidence", () => {
    const evidence = sampleIncomingAttackEvidence();
    const first = buildFleetAlertIntentFromEvidence(evidence);
    const second = buildFleetAlertIntentFromEvidence(evidence);

    expect(first?.dedupeKey).toBe(second?.dedupeKey);
    expect(first?.intentId).toBe(second?.intentId);
  });

  it("propagates missing evidence without assuming location data exists", () => {
    const intent = buildFleetAlertIntentFromEvidence(sampleIncomingAttackEvidence({
      missingEvidence: ["systemId", "resolvedFleetId"],
      location: undefined,
    }));

    expect(intent?.missingEvidence).toEqual(["systemId", "resolvedFleetId"]);
    expect(intent?.location).toBeUndefined();
  });

  it("filters unsupported fleet alert evidence event types", () => {
    const ignored = sampleArrivalEvidence({ eventType: "fleet.started_mining" });

    expect(buildFleetAlertIntentFromEvidence(ignored)).toBeNull();
    expect(buildFleetAlertIntentsFromEvidence([ignored, sampleArrivalEvidence()])).toHaveLength(1);
  });
});

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
    missingEvidence: ["systemId", "targetShipDisplayName"],
    ...overrides,
  };
}
