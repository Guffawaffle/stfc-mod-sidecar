import type { BattleReportEvent } from "../events/types.js";

import type { FleetProjectionSlot } from "./fleet-telemetry.js";

export const FLEET_SHIP_RECENT_COMBAT_PREVIEW_SCHEMA_VERSION = "stfc.fleet.ship_recent_combat.preview.v1" as const;

export type FleetShipRecentCombatMatchConfidence = "strong_exact_ship_id";

export interface FleetShipRecentCombatBattleInput {
  localId?: number;
  observedAt: string;
  outcome?: string;
  opponentName?: string;
  opponentType?: string;
  rounds?: number;
  shipIdExact?: string;
  shipIdsExact?: readonly string[];
  ship_ids_exact?: readonly string[];
  source: string;
}

export interface FleetShipRecentCombatBattlePreview {
  localId?: number;
  observedAt: string;
  outcome?: string;
  opponentName?: string;
  opponentType?: string;
  rounds?: number;
  damageDealt: null;
  damageTaken: null;
  source: string;
}

export interface FleetShipRecentCombatRowPreview {
  slotKey: string;
  shipId?: string;
  shipType?: string;
  hullSpecId?: number;
  updatedAt: string;
}

export interface FleetShipRecentCombatMatch extends FleetShipRecentCombatRowPreview {
  shipId: string;
  matchConfidence: FleetShipRecentCombatMatchConfidence;
  recentBattles: FleetShipRecentCombatBattlePreview[];
}

export interface FleetShipRecentCombatPreview {
  schema: typeof FLEET_SHIP_RECENT_COMBAT_PREVIEW_SCHEMA_VERSION;
  provisional: true;
  matches: FleetShipRecentCombatMatch[];
  unmatchedBattles: FleetShipRecentCombatBattlePreview[];
  unmatchedFleetRows: FleetShipRecentCombatRowPreview[];
}

interface NormalizedRecentCombatBattle extends FleetShipRecentCombatBattlePreview {
  shipIds: string[];
}

export function buildRecentCombatByShipId(
  battles: readonly FleetShipRecentCombatBattleInput[],
): ReadonlyMap<string, FleetShipRecentCombatBattlePreview[]> {
  const normalizedBattles = battles
    .map(normalizeRecentCombatBattle)
    .filter(isDefined);
  const recentCombatByShipId = new Map<string, FleetShipRecentCombatBattlePreview[]>();

  for (const battle of normalizedBattles) {
    for (const shipId of battle.shipIds) {
      const existing = recentCombatByShipId.get(shipId) ?? [];
      existing.push(toBattlePreview(battle));
      recentCombatByShipId.set(shipId, sortBattlePreviews(existing));
    }
  }

  return recentCombatByShipId;
}

export function buildFleetShipRecentCombatPreview(
  fleetRows: readonly FleetProjectionSlot[],
  recentBattles: readonly FleetShipRecentCombatBattleInput[],
): FleetShipRecentCombatPreview {
  const normalizedRows = fleetRows
    .filter((row) => row.assignmentKind === "player_ship")
    .map(toFleetRowPreview)
    .sort(compareFleetRows);
  const normalizedBattles = recentBattles
    .map(normalizeRecentCombatBattle)
    .filter(isDefined)
    .sort(compareNormalizedBattles);
  const recentCombatByShipId = new Map<string, FleetShipRecentCombatBattlePreview[]>();

  for (const battle of normalizedBattles) {
    for (const shipId of battle.shipIds) {
      const existing = recentCombatByShipId.get(shipId) ?? [];
      existing.push(toBattlePreview(battle));
      recentCombatByShipId.set(shipId, sortBattlePreviews(existing));
    }
  }

  const matchedBattleKeys = new Set<string>();
  const matches: FleetShipRecentCombatMatch[] = [];
  const unmatchedFleetRows: FleetShipRecentCombatRowPreview[] = [];

  for (const row of normalizedRows) {
    if (!row.shipId) {
      unmatchedFleetRows.push(row);
      continue;
    }

    const recentCombat = recentCombatByShipId.get(row.shipId);
    if (!recentCombat || recentCombat.length === 0) {
      unmatchedFleetRows.push(row);
      continue;
    }

    matches.push({
      ...row,
      shipId: row.shipId,
      matchConfidence: "strong_exact_ship_id",
      recentBattles: recentCombat,
    });

    for (const battle of normalizedBattles) {
      if (battle.shipIds.includes(row.shipId)) {
        matchedBattleKeys.add(battlePreviewKey(battle));
      }
    }
  }

  const unmatchedBattles = normalizedBattles
    .filter((battle) => !matchedBattleKeys.has(battlePreviewKey(battle)))
    .map(toBattlePreview);

  return {
    schema: FLEET_SHIP_RECENT_COMBAT_PREVIEW_SCHEMA_VERSION,
    provisional: true,
    matches,
    unmatchedBattles,
    unmatchedFleetRows,
  };
}

export function summarizeBattleReportEventForRecentCombat(
  event: BattleReportEvent,
  options: { localId?: number } = {},
): FleetShipRecentCombatBattleInput | null {
  if (!isRecord(event.report)) {
    return null;
  }

  const fleets = Array.isArray(event.report.fleets) ? event.report.fleets.filter(isRecord) : [];
  const playerFleets = fleets.filter((fleet) => participantKind(fleet) === "player");
  const opponentFleet = fleets.find((fleet) => participantKind(fleet) !== "player") ?? null;
  const summary = isRecord(event.report.summary) ? event.report.summary : null;
  const roundCount = finiteInteger(summary?.roundCount)
    ?? (Array.isArray(event.report.rounds) ? event.report.rounds.length : undefined);
  const shipIdsExact = uniqueExactShipIds(playerFleets.flatMap(extractExactShipIds));
  const localId = finiteInteger(options.localId);

  return {
    ...(localId !== undefined ? { localId } : {}),
    observedAt: event.timestamp,
    outcome: safeText(summary?.outcome),
    opponentName: opponentFleet ? displayName(opponentFleet) : undefined,
    opponentType: opponentFleet ? participantKind(opponentFleet) : undefined,
    rounds: roundCount,
    shipIdsExact,
    source: "battle.report",
  };
}

function normalizeRecentCombatBattle(
  battle: FleetShipRecentCombatBattleInput,
): NormalizedRecentCombatBattle | null {
  if (typeof battle.observedAt !== "string" || Number.isNaN(Date.parse(battle.observedAt))) {
    return null;
  }

  const shipIds = uniqueExactShipIds([
    ...exactShipIdsFromList(battle.shipIdsExact),
    ...exactShipIdsFromList(battle.ship_ids_exact),
    ...exactShipIdsFromList(battle.shipIdExact ? [battle.shipIdExact] : []),
  ]);
  const rounds = finiteInteger(battle.rounds);
  const localId = finiteInteger(battle.localId);

  return {
    ...(localId !== undefined ? { localId } : {}),
    observedAt: battle.observedAt,
    ...(safeText(battle.outcome) ? { outcome: safeText(battle.outcome) } : {}),
    ...(safeText(battle.opponentName) ? { opponentName: safeText(battle.opponentName) } : {}),
    ...(safeText(battle.opponentType) ? { opponentType: safeText(battle.opponentType) } : {}),
    ...(rounds !== undefined ? { rounds } : {}),
    damageDealt: null,
    damageTaken: null,
    source: safeText(battle.source) ?? "unknown",
    shipIds,
  };
}

function toFleetRowPreview(row: FleetProjectionSlot): FleetShipRecentCombatRowPreview {
  return {
    slotKey: row.slotKey,
    ...(exactShipId(row.shipIdentityId) ? { shipId: exactShipId(row.shipIdentityId) } : {}),
    ...(row.shipType ? { shipType: row.shipType } : {}),
    ...(Number.isInteger(row.hullSpecId) ? { hullSpecId: Math.trunc(row.hullSpecId as number) } : {}),
    updatedAt: row.updatedAt,
  };
}

function toBattlePreview(battle: NormalizedRecentCombatBattle): FleetShipRecentCombatBattlePreview {
  return {
    ...(battle.localId !== undefined ? { localId: battle.localId } : {}),
    observedAt: battle.observedAt,
    ...(battle.outcome ? { outcome: battle.outcome } : {}),
    ...(battle.opponentName ? { opponentName: battle.opponentName } : {}),
    ...(battle.opponentType ? { opponentType: battle.opponentType } : {}),
    ...(battle.rounds !== undefined ? { rounds: battle.rounds } : {}),
    damageDealt: null,
    damageTaken: null,
    source: battle.source,
  };
}

function battlePreviewKey(battle: NormalizedRecentCombatBattle): string {
  const localId = battle.localId ?? "none";
  return `${battle.source}:${battle.observedAt}:${localId}:${battle.shipIds.join(",")}`;
}

function extractExactShipIds(value: Record<string, unknown>): string[] {
  return uniqueExactShipIds([
    ...exactShipIdsFromList(asStringArray(value.ship_ids_exact)),
    ...exactShipIdsFromList(asStringArray(value.shipIdsExact)),
    ...exactShipIdsFromList(typeof value.shipIdExact === "string" ? [value.shipIdExact] : []),
  ]);
}

function participantKind(value: Record<string, unknown>): string | undefined {
  return safeText(value.participant_kind) ?? safeText(value.participantKind) ?? undefined;
}

function displayName(value: Record<string, unknown>): string | undefined {
  return safeText(value.display_name) ?? safeText(value.displayName) ?? safeText(value.name) ?? undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function exactShipIdsFromList(values: readonly string[] | undefined): string[] {
  return (values ?? [])
    .map(exactShipId)
    .filter(isDefined);
}

function uniqueExactShipIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function exactShipId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return /^\d+$/u.test(normalized) ? normalized : undefined;
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined;
  }

  return Math.trunc(value);
}

function sortBattlePreviews(
  battles: readonly FleetShipRecentCombatBattlePreview[],
): FleetShipRecentCombatBattlePreview[] {
  return [...battles].sort(compareBattlePreviews);
}

function compareBattlePreviews(
  left: FleetShipRecentCombatBattlePreview,
  right: FleetShipRecentCombatBattlePreview,
): number {
  const observedAtOrder = right.observedAt.localeCompare(left.observedAt);
  if (observedAtOrder !== 0) {
    return observedAtOrder;
  }

  return (right.localId ?? -1) - (left.localId ?? -1);
}

function compareNormalizedBattles(left: NormalizedRecentCombatBattle, right: NormalizedRecentCombatBattle): number {
  return compareBattlePreviews(left, right);
}

function compareFleetRows(left: FleetShipRecentCombatRowPreview, right: FleetShipRecentCombatRowPreview): number {
  return left.slotKey.localeCompare(right.slotKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}