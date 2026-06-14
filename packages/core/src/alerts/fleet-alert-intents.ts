import { createHash } from "node:crypto";

import {
  FLEET_ALERT_EVIDENCE_SCHEMA_VERSION,
  type FleetAlertEvidenceEvent,
  type JsonObject,
} from "../events/types.js";

export const FLEET_ALERT_INTENT_SCHEMA_VERSION = "stfc.sidecar.fleet-alert-intent.v0" as const;
export const FLEET_ALERT_INTENT_TYPE = "fleet.alert_intent" as const;

export type FleetAlertIntentKind = "fleet_arrival" | "fleet_incoming_attack";

export interface FleetAlertIntentEvidenceRef {
  readonly protocolVersion: string;
  readonly type: FleetAlertEvidenceEvent["type"];
  readonly schemaVersion: typeof FLEET_ALERT_EVIDENCE_SCHEMA_VERSION;
  readonly eventType: string;
  readonly timestamp: string;
  readonly source?: string;
  readonly dispatch?: JsonObject;
}

export interface FleetAlertStateFacts {
  readonly previous?: number;
  readonly previousName?: string;
  readonly current?: number;
  readonly currentName?: string;
}

export interface FleetAlertFleetFacts {
  readonly fleetId?: string;
  readonly slotIndex?: number;
  readonly state?: FleetAlertStateFacts;
  readonly shipDisplayName?: string;
}

export interface FleetAlertShipFacts {
  readonly shipId?: string;
  readonly hullSpecId?: string;
  readonly displayName?: string;
  readonly hullName?: string;
}

export interface FleetAlertTargetFacts {
  readonly fleetId?: string;
  readonly targetType?: number;
  readonly targetTypeName?: string;
}

export interface FleetAlertAttackerFacts {
  readonly fleetType?: number;
  readonly kind?: string;
  readonly identity?: string;
}

export interface FleetAlertIntent {
  readonly type: typeof FLEET_ALERT_INTENT_TYPE;
  readonly schemaVersion: typeof FLEET_ALERT_INTENT_SCHEMA_VERSION;
  readonly intentId: string;
  readonly dedupeKey: string;
  readonly kind: FleetAlertIntentKind;
  readonly eventType: string;
  readonly timestamp: string;
  readonly capturedAtUnixMs?: number;
  readonly observedAtUnixMs?: number;
  readonly source?: string;
  readonly evidence: FleetAlertIntentEvidenceRef;
  readonly fleet?: FleetAlertFleetFacts;
  readonly ship?: FleetAlertShipFacts;
  readonly target?: FleetAlertTargetFacts;
  readonly attacker?: FleetAlertAttackerFacts;
  readonly location?: JsonObject;
  readonly missingEvidence: readonly string[];
}

const FLEET_ARRIVAL_EVENT_TYPES = new Set([
  "fleet.arrived_in_system",
  "fleet.arrived_at_destination",
]);

export function buildFleetAlertIntentFromEvidence(evidence: FleetAlertEvidenceEvent): FleetAlertIntent | null {
  const kind = intentKindForFleetAlertEvidence(evidence);
  if (!kind) {
    return null;
  }

  const fleet = fleetFacts(evidence);
  const ship = shipFacts(evidence);
  const target = targetFacts(evidence);
  const attacker = attackerFacts(evidence);
  const location = cloneJsonObject(evidence.location);
  const missingEvidence = [...(evidence.missingEvidence ?? [])];
  const dedupeKey = buildFleetAlertIntentDedupeKey(evidence, kind);

  return {
    type: FLEET_ALERT_INTENT_TYPE,
    schemaVersion: FLEET_ALERT_INTENT_SCHEMA_VERSION,
    intentId: `fleet-alert-intent:${hashStableString(dedupeKey)}`,
    dedupeKey,
    kind,
    eventType: evidence.eventType,
    timestamp: evidence.timestamp,
    capturedAtUnixMs: evidence.capturedAtUnixMs,
    observedAtUnixMs: evidence.observedAtUnixMs,
    source: evidence.source,
    evidence: {
      protocolVersion: evidence.protocolVersion,
      type: evidence.type,
      schemaVersion: evidence.schemaVersion,
      eventType: evidence.eventType,
      timestamp: evidence.timestamp,
      source: evidence.source,
      dispatch: cloneJsonObject(evidence.dispatch),
    },
    fleet,
    ship,
    target,
    attacker,
    location,
    missingEvidence,
  };
}

export function buildFleetAlertIntentsFromEvidence(
  events: readonly FleetAlertEvidenceEvent[],
): FleetAlertIntent[] {
  return events.flatMap((event) => {
    const intent = buildFleetAlertIntentFromEvidence(event);
    return intent ? [intent] : [];
  });
}

function intentKindForFleetAlertEvidence(evidence: FleetAlertEvidenceEvent): FleetAlertIntentKind | undefined {
  if (FLEET_ARRIVAL_EVENT_TYPES.has(evidence.eventType)) {
    return "fleet_arrival";
  }

  if (evidence.eventType === "fleet.incoming_attack") {
    return "fleet_incoming_attack";
  }

  return undefined;
}

function buildFleetAlertIntentDedupeKey(
  evidence: FleetAlertEvidenceEvent,
  kind: FleetAlertIntentKind,
): string {
  const fleet = asRecord(evidence.fleet);
  const target = asRecord(evidence.target);
  const attacker = asRecord(evidence.attacker);
  const dispatch = asRecord(evidence.dispatch);
  const state = asRecord(fleet?.state);
  const observedAt = evidence.observedAtUnixMs ?? evidence.capturedAtUnixMs ?? evidence.timestamp;

  return [
    `kind=${kind}`,
    `eventType=${evidence.eventType}`,
    `fleetId=${readString(fleet, "fleetId") ?? ""}`,
    `slotIndex=${readNumber(fleet, "slotIndex") ?? ""}`,
    `targetFleetId=${readString(target, "fleetId") ?? ""}`,
    `attackerKind=${readString(attacker, "kind") ?? ""}`,
    `attackerIdentity=${readString(attacker, "identity") ?? ""}`,
    `state=${readNumber(state, "previous") ?? ""}>${readNumber(state, "current") ?? ""}`,
    `observedAt=${observedAt}`,
    `dispatch=${readString(dispatch, "owner") ?? ""}/${readString(dispatch, "seam") ?? ""}/${readString(dispatch, "reason") ?? ""}`,
  ].join("|");
}

function fleetFacts(evidence: FleetAlertEvidenceEvent): FleetAlertFleetFacts | undefined {
  const fleet = asRecord(evidence.fleet);
  if (!fleet) {
    return undefined;
  }

  const state = stateFacts(asRecord(fleet.state));
  return undefinedIfEmpty({
    fleetId: readString(fleet, "fleetId"),
    slotIndex: readNumber(fleet, "slotIndex"),
    state,
    shipDisplayName: readString(fleet, "shipDisplayName"),
  });
}

function shipFacts(evidence: FleetAlertEvidenceEvent): FleetAlertShipFacts | undefined {
  const ship = asRecord(evidence.ship);
  if (!ship) {
    return undefined;
  }

  return undefinedIfEmpty({
    shipId: readString(ship, "shipId"),
    hullSpecId: readString(ship, "hullSpecId"),
    displayName: readString(ship, "displayName"),
    hullName: readString(ship, "hullName"),
  });
}

function targetFacts(evidence: FleetAlertEvidenceEvent): FleetAlertTargetFacts | undefined {
  const target = asRecord(evidence.target);
  if (!target) {
    return undefined;
  }

  return undefinedIfEmpty({
    fleetId: readString(target, "fleetId"),
    targetType: readNumber(target, "targetType"),
    targetTypeName: readString(target, "targetTypeName"),
  });
}

function attackerFacts(evidence: FleetAlertEvidenceEvent): FleetAlertAttackerFacts | undefined {
  const attacker = asRecord(evidence.attacker);
  if (!attacker) {
    return undefined;
  }

  return undefinedIfEmpty({
    fleetType: readNumber(attacker, "fleetType"),
    kind: readString(attacker, "kind"),
    identity: readString(attacker, "identity"),
  });
}

function stateFacts(state: JsonObject | undefined): FleetAlertStateFacts | undefined {
  if (!state) {
    return undefined;
  }

  return undefinedIfEmpty({
    previous: readNumber(state, "previous"),
    previousName: readString(state, "previousName"),
    current: readNumber(state, "current"),
    currentName: readString(state, "currentName"),
  });
}

function asRecord(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function readString(record: JsonObject | undefined, key: string): string | undefined {
  const value = record?.[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function readNumber(record: JsonObject | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function undefinedIfEmpty<T extends object>(value: T): T | undefined {
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function cloneJsonObject(value: JsonObject | undefined): JsonObject | undefined {
  return value ? JSON.parse(JSON.stringify(value)) as JsonObject : undefined;
}

function hashStableString(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
