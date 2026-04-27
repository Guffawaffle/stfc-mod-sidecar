import { SIDECAR_EVENT_PROTOCOL_VERSION, type SidecarEvent, type SidecarEventType } from "../events/types.js";

export const DIAGNOSTIC_BUNDLE_SCHEMA_VERSION = "stfc.sidecar.diagnostic-bundle.v0" as const;

export interface DiagnosticBundleInput {
  sessionId?: string;
  createdAt?: string;
  events?: SidecarEvent[];
  notes?: string[];
}

export interface DiagnosticBundleSummary {
  eventCount: number;
  eventTypes: Partial<Record<SidecarEventType, number>>;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export interface DiagnosticBundle {
  schemaVersion: typeof DIAGNOSTIC_BUNDLE_SCHEMA_VERSION;
  protocolVersion: typeof SIDECAR_EVENT_PROTOCOL_VERSION;
  createdAt: string;
  sessionId?: string;
  summary: DiagnosticBundleSummary;
  notes: string[];
  events: SidecarEvent[];
}

export function createDiagnosticBundle(input: DiagnosticBundleInput = {}): DiagnosticBundle {
  const events = input.events ?? [];

  return {
    schemaVersion: DIAGNOSTIC_BUNDLE_SCHEMA_VERSION,
    protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sessionId: input.sessionId,
    summary: summarizeEvents(events),
    notes: input.notes ?? [],
    events,
  };
}

export function summarizeEvents(events: SidecarEvent[]): DiagnosticBundleSummary {
  const eventTypes: Partial<Record<SidecarEventType, number>> = {};
  for (const event of events) {
    eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
  }

  return {
    eventCount: events.length,
    eventTypes,
    firstTimestamp: events[0]?.timestamp,
    lastTimestamp: events.at(-1)?.timestamp,
  };
}
