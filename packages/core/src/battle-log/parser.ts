import { SIDECAR_EVENT_PROTOCOL_VERSION, type BattleEvent, type BattlePhase } from "../events/types.js";

export interface BattleLogLineParseOptions {
  timestamp?: string;
  sessionId?: string;
  source?: string;
  battleId?: string;
  lineNumber?: number;
}

export interface BattleLogTextParseOptions extends Omit<BattleLogLineParseOptions, "lineNumber"> {
  firstLineNumber?: number;
}

const PARSER_NAME = "stfc-sidecar-battle-log";
const PARSER_VERSION = "0.1.0";

const BATTLE_ID_PATTERN = /\bbattle(?:\s*id|Id)?\s*[:=#]\s*([A-Za-z0-9._-]+)/i;
const ROUND_PATTERN = /\b(?:round|turn)\s*#?\s*[:=]?\s*(\d{1,3})\b/i;
const DAMAGE_PATTERN = /\b(\d{1,3}(?:,\d{3})*|\d+)\s*(damage|dmg)\b/i;

export function parseBattleLogLine(line: string, options: BattleLogLineParseOptions = {}): BattleEvent {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const trimmedLine = line.trim();
  const battleId = extractBattleId(trimmedLine) ?? options.battleId;
  const round = extractRound(trimmedLine);
  const playerShip = extractLabeledText(trimmedLine, /\bplayer\s*ship\s*[:=]\s*([^|;,]+)/i)
    ?? extractLabeledText(trimmedLine, /\bplayerShip\s*[:=]\s*([^|;,]+)/i);
  const enemy = extractLabeledText(trimmedLine, /\benemy\s*[:=]\s*([^|;,]+)/i);
  const damage = extractDamage(trimmedLine);
  const phase = classifyPhase(trimmedLine, damage !== undefined, round !== undefined);
  const hasStructuredFields = battleId !== undefined || round !== undefined || playerShip !== undefined || enemy !== undefined || damage !== undefined;
  const parseStatus = phase === "unknown"
    ? hasStructuredFields ? "partial" : "unparsed"
    : "parsed";

  return {
    protocolVersion: SIDECAR_EVENT_PROTOCOL_VERSION,
    type: "battle.event",
    timestamp,
    sessionId: options.sessionId,
    source: options.source,
    battleId,
    phase,
    playerShip,
    enemy,
    round,
    damage,
    rawLine: line,
    parseStatus,
    parser: {
      name: PARSER_NAME,
      version: PARSER_VERSION,
      confidence: confidenceFor(phase, hasStructuredFields),
      source: options.source,
      lineNumber: options.lineNumber,
    },
  };
}

export function parseBattleLogText(text: string, options: BattleLogTextParseOptions = {}): BattleEvent[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const firstLineNumber = options.firstLineNumber ?? 1;
  return lines.map((line, index) => parseBattleLogLine(line, {
    ...options,
    lineNumber: firstLineNumber + index,
  }));
}

function extractBattleId(line: string): string | undefined {
  return BATTLE_ID_PATTERN.exec(line)?.[1];
}

function extractRound(line: string): number | undefined {
  const match = ROUND_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }

  return Number.parseInt(match[1], 10);
}

function extractLabeledText(line: string, pattern: RegExp): string | undefined {
  const value = pattern.exec(line)?.[1]
    ?.replace(/\s+(?:enemy|playerShip|player\s+ship|battle(?:\s*id|Id)|round|turn)\s*[:=#].*$/i, "")
    .trim();
  return value === "" ? undefined : value;
}

function extractDamage(line: string): BattleEvent["damage"] | undefined {
  const match = DAMAGE_PATTERN.exec(line);
  if (!match) {
    return undefined;
  }

  const total = Number.parseInt(match[1].replace(/,/g, ""), 10);
  if (!Number.isFinite(total)) {
    return undefined;
  }

  return {
    total,
    raw: match[0],
  };
}

function classifyPhase(line: string, hasDamage: boolean, hasRound: boolean): BattlePhase {
  if (/\b(?:battle|combat)\s+(?:started|starts|begin|began|begins)\b/i.test(line)) {
    return "started";
  }

  if (/\b(?:battle|combat)\s+(?:ended|ends|complete|completed)\b|\b(?:victory|defeat)\b/i.test(line)) {
    return "ended";
  }

  if (/\bcrit(?:ical)?\b/i.test(line)) {
    return "crit";
  }

  if (/\b(?:mitigated|mitigation|blocked|absorbed|shielded|dodged|deflected)\b/i.test(line)) {
    return "mitigation";
  }

  if (hasDamage) {
    return "damage";
  }

  if (hasRound) {
    return "round";
  }

  return "unknown";
}

function confidenceFor(phase: BattlePhase, hasStructuredFields: boolean): number {
  if (phase !== "unknown") {
    return 0.8;
  }

  return hasStructuredFields ? 0.5 : 0;
}
