import { createHash } from "node:crypto";

export const SIDECAR_TELEMETRY_PROTOCOL_VERSION = "stfc.telemetry.v1" as const;
export const FLEET_SNAPSHOT_SCHEMA_VERSION = "stfc.telemetry.fleet-snapshot.v1" as const;
export const FLEET_SLOT_CHANGED_SCHEMA_VERSION = "stfc.telemetry.fleet-slot-changed.v1" as const;
export const MAJEL_INGEST_PROTOCOL_VERSION = "majel.ingest.v1" as const;
export const FLEET_RUNTIME_SNAPSHOT_SCHEMA_VERSION = "stfc.fleet.runtime_snapshot.v1" as const;

const MAX_SNAPSHOT_SLOTS = 20;
const SOURCE = "stfc-sidecar" as const;
const CLASSIFICATION = "cloud_private" as const;

export interface ShipSyncItem {
  type: "ship";
  psid?: unknown;
  hull_id?: unknown;
  level?: unknown;
  tier?: unknown;
  [key: string]: unknown;
}

export interface SlotSyncItem {
  type: "slot";
  sid?: unknown;
  slot_type?: unknown;
  item_id?: unknown;
  [key: string]: unknown;
}

export type FleetSyncItem = ShipSyncItem | SlotSyncItem;

export interface FleetProjectionSlot {
  slotKey: string;
  fleetKey: string;
  state: string;
  assignmentKind: string;
  updatedAt: string;
  shipKeyHash?: string;
  shipType?: string;
  levelBand?: string;
  healthBand?: string;
}

interface FleetTelemetryEventBase<TType extends string, TSchemaVersion extends string> {
  protocolVersion: typeof SIDECAR_TELEMETRY_PROTOCOL_VERSION;
  schemaVersion: TSchemaVersion;
  type: TType;
  timestamp: string;
  installId: string;
  sessionId: string;
  source: typeof SOURCE;
  classification: typeof CLASSIFICATION;
  idempotencyKey: string;
}

export interface FleetSnapshotEvent extends FleetTelemetryEventBase<"fleet.snapshot", typeof FLEET_SNAPSHOT_SCHEMA_VERSION> {
  snapshotId: string;
  snapshotVersion: number;
  observedAt: string;
  sidecarVersion: string;
  fleetCount: number;
  slots: FleetProjectionSlot[];
  capabilities: {
    fleetProjection: true;
    battleSummary: true;
  };
  coalesceKey: string;
}

export interface FleetSlotChangedEvent extends FleetTelemetryEventBase<"fleet.slot.changed", typeof FLEET_SLOT_CHANGED_SCHEMA_VERSION> {
  slotKey: string;
  fleetKey: string;
  currentState: string;
  assignmentKind: string;
  observedAt: string;
  stateVersion: number;
  coalesceKey: string;
}

export type FleetTelemetryEvent = FleetSnapshotEvent | FleetSlotChangedEvent;

export interface FleetTelemetryBuildContext {
  installId: string;
  sessionId: string;
  sidecarVersion: string;
  timestamp: string;
  nextSequence: () => number;
}

export interface FleetRuntimeTelemetryBuildContext {
  installId: string;
  sidecarVersion: string;
}

export interface FleetRuntimeSnapshotPayload {
  type: "fleet.runtime";
  schemaVersion: typeof FLEET_RUNTIME_SNAPSHOT_SCHEMA_VERSION;
  source: string;
  observedAtMs?: number;
  fleetBarTracked?: boolean;
  selectedIndex?: number;
  fleet?: Record<string, unknown>;
  slots: Array<Record<string, unknown>>;
}

export interface FleetRuntimeMajelEnvelope {
  protocolVersion: typeof MAJEL_INGEST_PROTOCOL_VERSION;
  eventId: string;
  source: string;
  sourceVersion: string;
  installId: string;
  sessionId: string;
  sequence: number;
  observedAt: string;
  schema: typeof FLEET_RUNTIME_SNAPSHOT_SCHEMA_VERSION;
  classification: string;
  payload: FleetRuntimeSnapshotPayload;
}

export function normalizeFleetSyncPayload(payload: unknown): FleetSyncItem[] {
  const items = Array.isArray(payload) ? payload : [payload];
  return items.filter((item): item is FleetSyncItem => isFleetSyncItem(item));
}

export function extractFleetRuntimeMajelEnvelopes(payload: unknown): FleetRuntimeMajelEnvelope[] {
  const items = Array.isArray(payload) ? payload : [payload];
  return items.map(asFleetRuntimeMajelEnvelope).filter(isDefined);
}

export function countFleetRuntimeMajelEnvelopes(payload: unknown): number {
  return extractFleetRuntimeMajelEnvelopes(payload).length;
}

export function buildFleetTelemetryEvents(
  items: readonly FleetSyncItem[],
  context: FleetTelemetryBuildContext,
): FleetTelemetryEvent[] {
  const ships = items.filter((item): item is ShipSyncItem => item.type === "ship");
  const slots = items.filter((item): item is SlotSyncItem => item.type === "slot");
  const events: FleetTelemetryEvent[] = [];

  for (const shipChunk of chunk(ships, MAX_SNAPSHOT_SLOTS)) {
    const telemetrySlots = shipChunk.map((ship) => shipSyncItemToSlot(ship, context.timestamp)).filter(isDefined);
    if (telemetrySlots.length === 0) {
      continue;
    }

    const version = context.nextSequence();
    events.push(baseEvent("fleet.snapshot", FLEET_SNAPSHOT_SCHEMA_VERSION, context, version, {
      snapshotId: `ships-${version}`,
      snapshotVersion: version,
      observedAt: context.timestamp,
      sidecarVersion: context.sidecarVersion,
      fleetCount: telemetrySlots.length,
      slots: telemetrySlots,
      capabilities: { fleetProjection: true, battleSummary: true },
      coalesceKey: `${context.installId}:fleet.snapshot:${context.sessionId}`,
    }));
  }

  for (const slot of slots) {
    const event = slotSyncItemToEvent(slot, context);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

export function buildFleetRuntimeTelemetryEvents(
  envelopes: readonly FleetRuntimeMajelEnvelope[],
  context: FleetRuntimeTelemetryBuildContext,
): FleetTelemetryEvent[] {
  return envelopes
    .map((envelope) => fleetRuntimeEnvelopeToSnapshotEvent(envelope, context))
    .filter(isDefined);
}

function baseEvent<TType extends FleetTelemetryEvent["type"], TSchemaVersion extends FleetTelemetryEvent["schemaVersion"], TFields extends object>(
  type: TType,
  schemaVersion: TSchemaVersion,
  context: FleetTelemetryBuildContext,
  version: number,
  fields: TFields,
): FleetTelemetryEventBase<TType, TSchemaVersion> & TFields {
  return {
    protocolVersion: SIDECAR_TELEMETRY_PROTOCOL_VERSION,
    schemaVersion,
    type,
    timestamp: context.timestamp,
    installId: context.installId,
    sessionId: context.sessionId,
    source: SOURCE,
    classification: CLASSIFICATION,
    idempotencyKey: `sidecar:${type}:${shaHex(`${context.installId}:${context.sessionId}:${type}:${version}:${context.timestamp}`).slice(0, 48)}`,
    ...fields,
  };
}

function shipSyncItemToSlot(ship: ShipSyncItem, timestamp: string): FleetProjectionSlot | null {
  const shipId = finiteNumber(ship.psid);
  if (shipId === null) {
    return null;
  }

  const hullId = finiteNumber(ship.hull_id);
  const level = finiteNumber(ship.level);
  const tier = finiteNumber(ship.tier);
  const shipKeyHash = shaHex(`ship:${shipId}`).slice(0, 32);
  const fleetKey = `fleet-${shipKeyHash.slice(0, 16)}`;
  const slot: FleetProjectionSlot = {
    slotKey: `ship-${shipKeyHash.slice(0, 16)}`,
    fleetKey,
    shipKeyHash,
    state: "observed",
    assignmentKind: "player_ship",
    updatedAt: timestamp,
  };

  if (hullId !== null) {
    slot.shipType = `hull:${hullId}`;
  }
  if (level !== null) {
    slot.levelBand = levelBand(level);
  }
  if (tier !== null) {
    slot.healthBand = `tier:${tier}`;
  }

  return slot;
}

function slotSyncItemToEvent(slot: SlotSyncItem, context: FleetTelemetryBuildContext): FleetSlotChangedEvent | null {
  const slotId = finiteNumber(slot.sid);
  if (slotId === null) {
    return null;
  }

  const version = context.nextSequence();
  const slotHash = shaHex(`slot:${slotId}`).slice(0, 24);
  const itemId = finiteNumber(slot.item_id);
  const currentState = itemId === null || itemId < 0 ? "empty" : "assigned";
  const slotType = finiteNumber(slot.slot_type);
  return baseEvent("fleet.slot.changed", FLEET_SLOT_CHANGED_SCHEMA_VERSION, context, version, {
    slotKey: `slot-${slotHash}`,
    fleetKey: `slot-${slotHash}`,
    currentState,
    assignmentKind: slotType === null ? "slot" : `slot-type:${slotType}`,
    observedAt: context.timestamp,
    stateVersion: version,
    coalesceKey: `${context.installId}:fleet.slot:slot-${slotHash}`,
  });
}

function fleetRuntimeEnvelopeToSnapshotEvent(
  envelope: FleetRuntimeMajelEnvelope,
  context: FleetRuntimeTelemetryBuildContext,
): FleetSnapshotEvent | null {
  const slots = envelope.payload.slots
    .map((slot) => fleetRuntimeSlotToProjectionSlot(slot, envelope.observedAt, envelope.payload.fleetBarTracked !== false))
    .filter(isDefined);
  if (slots.length === 0) {
    return null;
  }

  const fleetCount = slots.filter((slot) => slot.assignmentKind === "player_ship").length;
  return {
    protocolVersion: SIDECAR_TELEMETRY_PROTOCOL_VERSION,
    schemaVersion: FLEET_SNAPSHOT_SCHEMA_VERSION,
    type: "fleet.snapshot",
    timestamp: envelope.observedAt,
    installId: context.installId,
    sessionId: envelope.sessionId,
    source: SOURCE,
    classification: CLASSIFICATION,
    idempotencyKey: `majel:fleet.snapshot:${shaHex(`${envelope.eventId}:${envelope.sequence}:${envelope.observedAt}`).slice(0, 48)}`,
    snapshotId: `runtime-${shaHex(envelope.eventId).slice(0, 24)}`,
    snapshotVersion: envelope.sequence,
    observedAt: envelope.observedAt,
    sidecarVersion: context.sidecarVersion,
    fleetCount,
    slots,
    capabilities: { fleetProjection: true, battleSummary: true },
    coalesceKey: `${context.installId}:fleet.snapshot:${envelope.sessionId}`,
  };
}

function fleetRuntimeSlotToProjectionSlot(
  slot: Record<string, unknown>,
  observedAt: string,
  fleetBarTracked: boolean,
): FleetProjectionSlot | null {
  const slotIndex = finiteInteger(slot.slotIndex);
  if (slotIndex === null || slotIndex < 0) {
    return null;
  }

  const present = slot.present === true;
  const fleetId = finiteInteger(slot.fleetId);
  const hullName = safeText(slot.hullName);
  const currentStateName = safeText(slot.currentStateName);
  const slotKey = `slot-${slotIndex}`;
  const fleetKey = present && fleetId !== null
    ? `fleet-${shaHex(`fleet:${fleetId}`).slice(0, 16)}`
    : `fleet-slot-${slotIndex}`;

  const projectionSlot: FleetProjectionSlot = {
    slotKey,
    fleetKey,
    state: runtimeSlotState(present, fleetBarTracked, currentStateName),
    assignmentKind: present ? "player_ship" : "slot",
    updatedAt: observedAt,
  };

  if (present && fleetId !== null) {
    projectionSlot.shipKeyHash = shaHex(`fleet:${fleetId}`).slice(0, 32);
  }
  if (present && hullName) {
    projectionSlot.shipType = `hull:${hullName}`;
  }

  return projectionSlot;
}

function runtimeSlotState(present: boolean, fleetBarTracked: boolean, currentStateName: string | null): string {
  if (!fleetBarTracked) {
    return "unavailable";
  }
  if (!present) {
    return "empty";
  }
  return currentStateName?.toLowerCase() ?? "observed";
}

function levelBand(level: number): string {
  if (level <= 9) {
    return "1-9";
  }

  const start = Math.floor(level / 10) * 10;
  return `${start}-${start + 9}`;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null ? Math.trunc(number) : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function shaHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function asFleetRuntimeMajelEnvelope(value: unknown): FleetRuntimeMajelEnvelope | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.protocolVersion !== MAJEL_INGEST_PROTOCOL_VERSION) {
    return null;
  }
  if (value.schema !== FLEET_RUNTIME_SNAPSHOT_SCHEMA_VERSION) {
    return null;
  }
  if (typeof value.eventId !== "string" || value.eventId.trim() === "") {
    return null;
  }
  if (typeof value.sessionId !== "string" || value.sessionId.trim() === "") {
    return null;
  }
  const sequence = finiteInteger(value.sequence);
  if (sequence === null || sequence < 0) {
    return null;
  }
  if (typeof value.observedAt !== "string" || Number.isNaN(Date.parse(value.observedAt))) {
    return null;
  }
  if (!isRecord(value.payload)) {
    return null;
  }
  const payload = value.payload;
  if (payload.type !== "fleet.runtime") {
    return null;
  }
  if (payload.schemaVersion !== FLEET_RUNTIME_SNAPSHOT_SCHEMA_VERSION) {
    return null;
  }
  if (!Array.isArray(payload.slots)) {
    return null;
  }

  return {
    protocolVersion: MAJEL_INGEST_PROTOCOL_VERSION,
    eventId: value.eventId,
    source: typeof value.source === "string" ? value.source : "unknown",
    sourceVersion: typeof value.sourceVersion === "string" ? value.sourceVersion : "unknown",
    installId: typeof value.installId === "string" ? value.installId : "unknown",
    sessionId: value.sessionId,
    sequence,
    observedAt: value.observedAt,
    schema: FLEET_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
    classification: typeof value.classification === "string" ? value.classification : "cloud_private",
    payload: {
      type: "fleet.runtime",
      schemaVersion: FLEET_RUNTIME_SNAPSHOT_SCHEMA_VERSION,
      source: typeof payload.source === "string" ? payload.source : "unknown",
      observedAtMs: finiteInteger(payload.observedAtMs) ?? undefined,
      fleetBarTracked: payload.fleetBarTracked === true,
      selectedIndex: finiteInteger(payload.selectedIndex) ?? undefined,
      fleet: isRecord(payload.fleet) ? payload.fleet : undefined,
      slots: payload.slots.filter(isRecord),
    },
  };
}

function isFleetSyncItem(value: unknown): value is FleetSyncItem {
  return isRecord(value) && (value.type === "ship" || value.type === "slot");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function safeText(value: unknown, maxLength = 80): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}