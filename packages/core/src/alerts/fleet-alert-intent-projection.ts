import type { SidecarEvent } from "../events/types.js";
import { buildFleetAlertIntentFromEvidence, type FleetAlertIntent } from "./fleet-alert-intents.js";

export const FLEET_ALERT_INTENT_PROJECTION_SCHEMA_VERSION = "stfc.sidecar.fleet-alert-intent-projection.v0" as const;

export type FleetAlertIntentProjectionSkipReason =
  | "not_fleet_alert_evidence"
  | "unsupported_fleet_alert_event_type";

export interface FleetAlertStoredEventInput {
  readonly sequenceId: number;
  readonly eventKey: string;
  readonly event: SidecarEvent;
}

export interface FleetAlertIntentProjectionItem {
  readonly sequenceId: number;
  readonly eventKey: string;
  readonly intent: FleetAlertIntent;
}

export interface FleetAlertIntentProjectionSkippedItem {
  readonly sequenceId: number;
  readonly eventKey: string;
  readonly eventType: string;
  readonly reason: FleetAlertIntentProjectionSkipReason;
}

export interface FleetAlertIntentProjection {
  readonly schemaVersion: typeof FLEET_ALERT_INTENT_PROJECTION_SCHEMA_VERSION;
  readonly generatedAt?: string;
  readonly sourceEventCount: number;
  readonly intentCount: number;
  readonly skippedCount: number;
  readonly items: readonly FleetAlertIntentProjectionItem[];
  readonly skipped: readonly FleetAlertIntentProjectionSkippedItem[];
}

export interface FleetAlertIntentProjectionOptions {
  readonly generatedAt?: string;
}

export function buildFleetAlertIntentProjectionFromStoredEvents(
  storedEvents: readonly FleetAlertStoredEventInput[],
  options: FleetAlertIntentProjectionOptions = {},
): FleetAlertIntentProjection {
  const items: FleetAlertIntentProjectionItem[] = [];
  const skipped: FleetAlertIntentProjectionSkippedItem[] = [];

  for (const storedEvent of storedEvents) {
    if (storedEvent.event.type !== "fleet.alert_evidence") {
      skipped.push({
        sequenceId: storedEvent.sequenceId,
        eventKey: storedEvent.eventKey,
        eventType: storedEvent.event.type,
        reason: "not_fleet_alert_evidence",
      });
      continue;
    }

    const intent = buildFleetAlertIntentFromEvidence(storedEvent.event);
    if (!intent) {
      skipped.push({
        sequenceId: storedEvent.sequenceId,
        eventKey: storedEvent.eventKey,
        eventType: storedEvent.event.eventType,
        reason: "unsupported_fleet_alert_event_type",
      });
      continue;
    }

    items.push({
      sequenceId: storedEvent.sequenceId,
      eventKey: storedEvent.eventKey,
      intent,
    });
  }

  return {
    schemaVersion: FLEET_ALERT_INTENT_PROJECTION_SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    sourceEventCount: storedEvents.length,
    intentCount: items.length,
    skippedCount: skipped.length,
    items,
    skipped,
  };
}
