import { describe, expect, it } from "vitest";

import {
  STFC_MOD_PAYLOAD_RESOURCE_VERSION,
  type PayloadResourceEnvelope,
  type PayloadResourceExtensions,
} from "./payload-resource.js";

interface FleetAlertObservationDetails {
  readonly eventType: "fleet.arrived_in_system";
  readonly fleetId: string;
  readonly shipId?: string;
  readonly location?: {
    readonly systemId?: string;
  };
}

interface FleetAlertIntentDetails {
  readonly kind: "fleet_arrival";
  readonly fleetId: string;
  readonly shipId: string;
  readonly dedupeKey: string;
}

describe("payload resource contract", () => {
  it("supports a copied observation resource with typed details and provenance", () => {
    const resource = {
      resourceVersion: STFC_MOD_PAYLOAD_RESOURCE_VERSION,
      resourceType: "fleet.alert_evidence",
      profile: "stfc.fleet.alert_evidence.v0",
      category: "observation",
      id: "fleet-alert-evidence:42",
      timestamp: "2026-06-11T12:34:56.000Z",
      provenance: {
        source: "stfc-community-mod",
        producer: "native",
        seam: "Digit.Prime.HUD.FleetStateWidget.SetWidgetData",
        reason: "fleet-slot-arrived-in-system",
        observedAt: "2026-06-11T12:34:56.000Z",
        eventKey: "fleet-alert-evidence-key",
        sequenceId: 42,
      },
      details: {
        eventType: "fleet.arrived_in_system",
        fleetId: "12345678901234567890",
        shipId: "9876543210987654321",
      },
      missingEvidence: ["systemId"],
    } satisfies PayloadResourceEnvelope<
      FleetAlertObservationDetails,
      "fleet.alert_evidence",
      "stfc.fleet.alert_evidence.v0"
    >;

    expect(resource.resourceVersion).toBe(STFC_MOD_PAYLOAD_RESOURCE_VERSION);
    expect(resource.category).toBe("observation");
    expect(resource.provenance.seam).toContain("FleetStateWidget");
    expect(resource.details.fleetId).toBe("12345678901234567890");
    expect(typeof resource.details.fleetId).toBe("string");
    expect(resource.missingEvidence).toEqual(["systemId"]);
  });

  it("supports an intent resource derived from an observation without provider shape", () => {
    const resource = {
      resourceVersion: STFC_MOD_PAYLOAD_RESOURCE_VERSION,
      resourceType: "fleet.alert_intent",
      profile: "stfc.sidecar.fleet-alert-intent.v0",
      category: "intent",
      id: "fleet-alert-intent:abc123",
      timestamp: "2026-06-11T12:34:56.000Z",
      provenance: {
        source: "stfc-mod-sidecar",
        producer: "sidecar",
        generatedAt: "2026-06-11T12:34:57.000Z",
        derivedFrom: [{
          resourceType: "fleet.alert_evidence",
          id: "fleet-alert-evidence:42",
          profile: "stfc.fleet.alert_evidence.v0",
        }],
      },
      details: {
        kind: "fleet_arrival",
        fleetId: "12345678901234567890",
        shipId: "9876543210987654321",
        dedupeKey: "kind=fleet_arrival|fleetId=12345678901234567890",
      },
      missingEvidence: ["systemId"],
    } satisfies PayloadResourceEnvelope<
      FleetAlertIntentDetails,
      "fleet.alert_intent",
      "stfc.sidecar.fleet-alert-intent.v0"
    >;

    expect(resource.category).toBe("intent");
    expect(resource.provenance.derivedFrom?.[0]).toMatchObject({
      resourceType: "fleet.alert_evidence",
      id: "fleet-alert-evidence:42",
    });
    expect(resource.details.shipId).toBe("9876543210987654321");
    expect(resource).not.toHaveProperty("provider");
    expect(resource).not.toHaveProperty("fulfillment");
  });

  it("allows partial details and explicit missing evidence markers", () => {
    const resource = {
      resourceVersion: STFC_MOD_PAYLOAD_RESOURCE_VERSION,
      resourceType: "fleet.alert_evidence",
      profile: "stfc.fleet.alert_evidence.v0",
      category: "observation",
      id: "fleet-alert-evidence:partial",
      timestamp: "2026-06-11T12:35:10.000Z",
      provenance: {
        source: "stfc-community-mod",
        producer: "native",
      },
      details: {
        eventType: "fleet.arrived_in_system",
        fleetId: "4001",
      },
      missingEvidence: ["systemId", "shipId"],
    } satisfies PayloadResourceEnvelope<
      FleetAlertObservationDetails,
      "fleet.alert_evidence",
      "stfc.fleet.alert_evidence.v0"
    >;

    expect(resource.details.shipId).toBeUndefined();
    expect(resource.details.location).toBeUndefined();
    expect(resource.missingEvidence).toEqual(["systemId", "shipId"]);
  });

  it("allows namespaced data-only extensions without moving domain data into the envelope", () => {
    const extensions = {
      "stfc.mod/fleet-alert-capture": {
        confidence: "copied",
        observedFields: ["fleetId", "shipId"],
        score: 1,
      },
    } satisfies PayloadResourceExtensions;

    const resource = {
      resourceVersion: STFC_MOD_PAYLOAD_RESOURCE_VERSION,
      resourceType: "fleet.alert_evidence",
      profile: "stfc.fleet.alert_evidence.v0",
      category: "observation",
      id: "fleet-alert-evidence:extension",
      timestamp: "2026-06-11T12:34:56.000Z",
      provenance: {
        source: "stfc-community-mod",
      },
      details: {
        eventType: "fleet.arrived_in_system",
        fleetId: "12345678901234567890",
      },
      extensions,
      missingEvidence: ["systemId"],
    } satisfies PayloadResourceEnvelope<
      FleetAlertObservationDetails,
      "fleet.alert_evidence",
      "stfc.fleet.alert_evidence.v0"
    >;

    expect(Object.keys(resource.extensions ?? {})).toEqual(["stfc.mod/fleet-alert-capture"]);
    expect(resource.extensions?.["stfc.mod/fleet-alert-capture"]).toMatchObject({
      confidence: "copied",
      observedFields: ["fleetId", "shipId"],
      score: 1,
    });
    expect(resource.details.fleetId).toBe("12345678901234567890");
  });
});
