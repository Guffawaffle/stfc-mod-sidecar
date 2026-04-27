import {
  SIDECAR_EVENT_PROTOCOL_VERSION,
  BATTLE_ANALYTICS_SCHEMA_VERSION,
  BATTLE_CAPTURE_SCHEMA_VERSION,
  BATTLE_REPORT_SCHEMA_VERSION,
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
  type BattleAnalyticsEvent,
  type BattleEvent,
  type BattleCaptureEvent,
  type BattleReportEvent,
  type CatalogSnapshotEvent,
  type DebugEvent,
  type HookEvent,
  type IntegrationEvent,
  type JsonObject,
  type SessionEvent,
  type SidecarEvent,
  type SidecarEventType,
} from "./types.js";

const EVENT_TYPES = new Set<SidecarEventType>([
  "debug.event",
  "hook.event",
  "battle.event",
  "battle.capture",
  "battle.analytics",
  "battle.report",
  "catalog.snapshot",
  "session.event",
  "integration.event",
]);

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isEventType(value: unknown): value is SidecarEventType {
  return isString(value) && EVENT_TYPES.has(value as SidecarEventType);
}

function hasBaseEnvelope(value: JsonObject): value is JsonObject & Pick<SidecarEvent, "protocolVersion" | "type" | "timestamp"> {
  return (
    value.protocolVersion === SIDECAR_EVENT_PROTOCOL_VERSION &&
    isEventType(value.type) &&
    isString(value.timestamp)
  );
}

export function isSidecarEvent(value: unknown): value is SidecarEvent {
  if (!isRecord(value) || !hasBaseEnvelope(value)) {
    return false;
  }

  switch (value.type) {
    case "debug.event":
      return isDebugEvent(value);
    case "hook.event":
      return isHookEvent(value);
    case "battle.event":
      return isBattleEvent(value);
    case "battle.capture":
      return isBattleCaptureEvent(value);
    case "battle.analytics":
      return isBattleAnalyticsEvent(value);
    case "battle.report":
      return isBattleReportEvent(value);
    case "catalog.snapshot":
      return isCatalogSnapshotEvent(value);
    case "session.event":
      return isSessionEvent(value);
    case "integration.event":
      return isIntegrationEvent(value);
  }
}

export function isDebugEvent(value: unknown): value is DebugEvent {
  return (
    isRecord(value) &&
    value.type === "debug.event" &&
    isString(value.level) &&
    isString(value.source) &&
    isString(value.message)
  );
}

export function isHookEvent(value: unknown): value is HookEvent {
  return isRecord(value) && value.type === "hook.event" && isString(value.hookName) && isString(value.status);
}

export function isBattleEvent(value: unknown): value is BattleEvent {
  return isRecord(value) && value.type === "battle.event" && isString(value.phase);
}

export function isBattleCaptureEvent(value: unknown): value is BattleCaptureEvent {
  if (
    !isRecord(value) ||
    value.type !== "battle.capture" ||
    value.schemaVersion !== BATTLE_CAPTURE_SCHEMA_VERSION ||
    !isString(value.journalId) ||
    !isRecord(value.capture)
  ) {
    return false;
  }

  const battleLog = value.capture.battleLog;
  if (battleLog === undefined) {
    return true;
  }

  return isRecord(battleLog) && Array.isArray(battleLog.tokens) && battleLog.tokens.every(isString);
}

export function isBattleReportEvent(value: unknown): value is BattleReportEvent {
  return (
    isRecord(value) &&
    value.type === "battle.report" &&
    value.schemaVersion === BATTLE_REPORT_SCHEMA_VERSION &&
    isString(value.journalId) &&
    isRecord(value.report)
  );
}

export function isBattleAnalyticsEvent(value: unknown): value is BattleAnalyticsEvent {
  return (
    isRecord(value) &&
    value.type === "battle.analytics" &&
    value.schemaVersion === BATTLE_ANALYTICS_SCHEMA_VERSION &&
    isString(value.journalId) &&
    isRecord(value.analytics)
  );
}

export function isCatalogSnapshotEvent(value: unknown): value is CatalogSnapshotEvent {
  if (
    !isRecord(value) ||
    value.type !== "catalog.snapshot" ||
    value.schemaVersion !== CATALOG_SNAPSHOT_SCHEMA_VERSION ||
    !isString(value.journalId) ||
    !isRecord(value.catalog)
  ) {
    return false;
  }

  const catalog = value.catalog as JsonObject;
  if (!isRecord(catalog.domains) || !isRecord(catalog.coverage)) {
    return false;
  }

  return true;
}

export function isSessionEvent(value: unknown): value is SessionEvent {
  return isRecord(value) && value.type === "session.event" && isString(value.phase);
}

export function isIntegrationEvent(value: unknown): value is IntegrationEvent {
  return (
    isRecord(value) &&
    value.type === "integration.event" &&
    isString(value.provider) &&
    isString(value.action) &&
    isString(value.status)
  );
}

export type ParseEventJsonLineResult =
  | { ok: true; event: SidecarEvent }
  | { ok: false; rawLine: string; error: string };

export function parseEventJsonLine(line: string): ParseEventJsonLineResult {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isSidecarEvent(parsed)) {
      return { ok: false, rawLine: line, error: "JSON line is not a recognized sidecar event" };
    }

    return { ok: true, event: parsed };
  } catch (error) {
    return {
      ok: false,
      rawLine: line,
      error: error instanceof Error ? error.message : "Failed to parse JSON line",
    };
  }
}

export function serializeEventJsonLine(event: SidecarEvent): string {
  return `${JSON.stringify(event)}\n`;
}
