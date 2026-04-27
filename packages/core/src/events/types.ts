export const SIDECAR_EVENT_PROTOCOL_VERSION = "stfc.sidecar.events.v0" as const;

export type JsonObject = Record<string, unknown>;
export type IsoTimestamp = string;

export type SidecarEventType =
  | "debug.event"
  | "hook.event"
  | "battle.event"
  | "battle.capture"
  | "battle.report"
  | "session.event"
  | "integration.event";

export interface SidecarEventBase<TType extends SidecarEventType> {
  protocolVersion: typeof SIDECAR_EVENT_PROTOCOL_VERSION;
  type: TType;
  timestamp: IsoTimestamp;
  sessionId?: string;
  modVersion?: string;
  source?: string;
}

export type DebugLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface DebugEvent extends SidecarEventBase<"debug.event"> {
  level: DebugLevel;
  source: string;
  message: string;
  context?: JsonObject;
}

export type HookStatus = "installed" | "failed" | "disabled" | "fallback";

export interface HookEvent extends SidecarEventBase<"hook.event"> {
  hookName: string;
  status: HookStatus;
  backend?: string;
  error?: string;
  context?: JsonObject;
}

export type BattlePhase =
  | "started"
  | "round"
  | "damage"
  | "crit"
  | "mitigation"
  | "ended"
  | "unknown";

export type BattleParseStatus = "parsed" | "partial" | "unparsed";

export interface BattleDamageValues {
  shield?: number;
  hull?: number;
  total?: number;
  raw?: string;
}

export interface BattleParserMetadata {
  name: string;
  version: string;
  confidence: number;
  source?: string;
  lineNumber?: number;
}

export interface BattleEvent extends SidecarEventBase<"battle.event"> {
  battleId?: string;
  phase: BattlePhase;
  playerShip?: string;
  enemy?: string;
  round?: number;
  damage?: BattleDamageValues;
  rawLine?: string;
  parseStatus?: BattleParseStatus;
  parser?: BattleParserMetadata;
}

export const BATTLE_REPORT_SCHEMA_VERSION = "stfc.sidecar.battle-report.v0" as const;
export const BATTLE_CAPTURE_SCHEMA_VERSION = "stfc.battle.capture.v1" as const;

export interface BattleCaptureEvent extends SidecarEventBase<"battle.capture"> {
  schemaVersion: typeof BATTLE_CAPTURE_SCHEMA_VERSION;
  journalId: string;
  battleId?: string;
  battleType?: number;
  capturedAtUnixMs?: number;
  capture: {
    sourceKind: "scopely.journal.battle" | string;
    capturedAtUnixMs?: number;
    summary?: JsonObject;
    participants?: JsonObject[];
    battleLog?: {
      encoding: "string_tokens.v1" | string;
      tokenCount?: number;
      tokens: string[];
    };
    names?: JsonObject;
    journal?: JsonObject;
  };
}

export type BattleReportParityStatus = "structured" | "structured_ids" | "decoded_segments" | "partial" | "unavailable";

export interface BattleReportEvent extends SidecarEventBase<"battle.report"> {
  schemaVersion: typeof BATTLE_REPORT_SCHEMA_VERSION;
  journalId: string;
  battleId?: string;
  battleType?: number;
  capturedAtUnixMs?: number;
  parsedCount?: number;
  report: {
    summary: JsonObject;
    rewards: JsonObject[];
    fleets: JsonObject[];
    events: JsonObject[];
    rounds?: JsonObject[];
    attackRows?: JsonObject[];
    decode: JsonObject;
    parity: {
      reference?: string;
      sections?: Partial<Record<"battleSummary" | "rewards" | "fleetStats" | "battleEvents", BattleReportParityStatus>>;
      notes?: string[];
    };
    raw?: JsonObject;
  };
}

export type SessionPhase =
  | "sidecar_started"
  | "game_detected"
  | "mod_connected"
  | "mod_disconnected"
  | "session_ended";

export interface SessionEvent extends SidecarEventBase<"session.event"> {
  phase: SessionPhase;
  metadata?: JsonObject;
}

export type IntegrationProvider = "majel" | "spocks" | "stfc_space" | "overwolf" | "other";
export type IntegrationStatus = "requested" | "succeeded" | "failed" | "skipped";

export interface IntegrationEvent extends SidecarEventBase<"integration.event"> {
  provider: IntegrationProvider;
  action: string;
  status: IntegrationStatus;
  context?: JsonObject;
}

export type SidecarEvent =
  | DebugEvent
  | HookEvent
  | BattleEvent
  | BattleCaptureEvent
  | BattleReportEvent
  | SessionEvent
  | IntegrationEvent;
