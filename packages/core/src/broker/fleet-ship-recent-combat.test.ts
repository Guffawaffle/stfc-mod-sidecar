import { describe, expect, it } from "vitest";

import type { BattleReportEvent } from "../events/types.js";

import {
  buildFleetShipRecentCombatPreview,
  buildRecentCombatByShipId,
  summarizeBattleReportEventForRecentCombat,
  type FleetShipRecentCombatBattleInput,
} from "./fleet-ship-recent-combat.js";
import type { FleetProjectionSlot } from "./fleet-telemetry.js";

describe("fleet ship recent combat preview", () => {
  it("matches runtime ship identity ids against battle shipIdExact", () => {
    const preview = buildFleetShipRecentCombatPreview(
      [fleetRow({ slotKey: "slot-0", shipIdentityId: "2682548280591992155", shipType: "hull:USS Relativity" })],
      [
        battleInput({
          localId: 1880,
          observedAt: "2026-05-24T22:58:50Z",
          shipIdExact: "2682548280591992155",
          outcome: "initiator_victory",
          opponentName: "Lv.55 SurgeHostile Survey",
          opponentType: "hostile",
          rounds: 1,
          source: "battle.summary",
        }),
      ],
    );

    expect(preview.matches).toEqual([
      expect.objectContaining({
        slotKey: "slot-0",
        shipId: "2682548280591992155",
        matchConfidence: "strong_exact_ship_id",
        recentBattles: [
          expect.objectContaining({
            localId: 1880,
            observedAt: "2026-05-24T22:58:50Z",
            source: "battle.summary",
          }),
        ],
      }),
    ]);
    expect(preview.unmatchedBattles).toEqual([]);
    expect(preview.unmatchedFleetRows).toEqual([]);
  });

  it("matches runtime ship identity ids against battle ship_ids_exact", () => {
    const preview = buildFleetShipRecentCombatPreview(
      [fleetRow({ slotKey: "slot-1", shipIdentityId: "2679690622826529803", shipType: "hull:NSEA Protector" })],
      [
        battleInput({
          localId: 1884,
          observedAt: "2026-05-24T22:59:07Z",
          ship_ids_exact: ["2679690622826529803"],
          outcome: "initiator_victory",
          opponentName: "Lv.55 SurgeHostile Survey",
          opponentType: "hostile",
          rounds: 1,
          source: "battle.summary",
        }),
      ],
    );

    expect(preview.matches[0]).toMatchObject({
      slotKey: "slot-1",
      shipId: "2679690622826529803",
      matchConfidence: "strong_exact_ship_id",
    });
    expect(preview.matches[0]?.recentBattles[0]).toMatchObject({
      localId: 1884,
      source: "battle.summary",
    });
  });

  it("ignores rounded numeric shipId values for exact matching", () => {
    const preview = buildFleetShipRecentCombatPreview(
      [fleetRow({ slotKey: "slot-0", shipIdentityId: "2682548280591992155" })],
      [
        {
          localId: 1880,
          observedAt: "2026-05-24T22:58:50Z",
          source: "battle.summary",
          shipId: 2682548280591992300,
        } as FleetShipRecentCombatBattleInput & { shipId: number },
      ],
    );

    expect(preview.matches).toEqual([]);
    expect(preview.unmatchedFleetRows).toEqual([
      expect.objectContaining({ slotKey: "slot-0", shipId: "2682548280591992155" }),
    ]);
    expect(preview.unmatchedBattles).toEqual([
      expect.objectContaining({ localId: 1880, source: "battle.summary" }),
    ]);
  });

  it("does not use fleetId or fleetIdExact to drive ship matching", () => {
    const preview = buildFleetShipRecentCombatPreview(
      [fleetRow({ slotKey: "slot-0", shipIdentityId: "2682548280591992155" })],
      [
        {
          localId: 1880,
          observedAt: "2026-05-24T22:58:50Z",
          source: "battle.summary",
          shipIdExact: "2679690622826529803",
          fleetIdExact: "2644013931949275840",
        } as FleetShipRecentCombatBattleInput & { fleetIdExact: string },
      ],
    );

    expect(preview.matches).toEqual([]);
    expect(preview.unmatchedBattles).toHaveLength(1);
    expect(preview.unmatchedFleetRows).toHaveLength(1);
  });

  it("leaves rows with missing exact runtime ids unmatched", () => {
    const preview = buildFleetShipRecentCombatPreview(
      [fleetRow({ slotKey: "slot-0", shipIdentityId: undefined, shipType: "hull:USS Relativity" })],
      [battleInput({ localId: 1880, observedAt: "2026-05-24T22:58:50Z", shipIdExact: "2682548280591992155", source: "battle.summary" })],
    );

    expect(preview.matches).toEqual([]);
    expect(preview.unmatchedFleetRows).toEqual([
      expect.objectContaining({ slotKey: "slot-0", shipType: "hull:USS Relativity" }),
    ]);
    expect(preview.unmatchedBattles).toHaveLength(1);
  });

  it("does not collide same-hull ships when exact ids differ", () => {
    const preview = buildFleetShipRecentCombatPreview(
      [
        fleetRow({ slotKey: "slot-0", shipIdentityId: "2682548280591992155", shipType: "hull:USS Relativity" }),
        fleetRow({ slotKey: "slot-1", shipIdentityId: "2679690622826529803", shipType: "hull:USS Relativity" }),
      ],
      [
        battleInput({ localId: 1880, observedAt: "2026-05-24T22:58:50Z", shipIdExact: "2682548280591992155", source: "battle.summary" }),
      ],
    );

    expect(preview.matches).toHaveLength(1);
    expect(preview.matches[0]).toMatchObject({ slotKey: "slot-0", shipId: "2682548280591992155" });
    expect(preview.unmatchedFleetRows).toEqual([
      expect.objectContaining({ slotKey: "slot-1", shipId: "2679690622826529803" }),
    ]);
  });

  it("reports unmatched battles separately", () => {
    const preview = buildFleetShipRecentCombatPreview(
      [fleetRow({ slotKey: "slot-0", shipIdentityId: "2682548280591992155" })],
      [battleInput({ localId: 1881, observedAt: "2026-05-24T22:58:51Z", shipIdExact: "2667207912673592502", source: "battle.summary" })],
    );

    expect(preview.matches).toEqual([]);
    expect(preview.unmatchedBattles).toEqual([
      expect.objectContaining({ localId: 1881, source: "battle.summary" }),
    ]);
  });

  it("indexes recent combat by exact ship id only", () => {
    const index = buildRecentCombatByShipId([
      battleInput({ localId: 1880, observedAt: "2026-05-24T22:58:50Z", shipIdExact: "2682548280591992155", source: "battle.summary" }),
      battleInput({ localId: 1884, observedAt: "2026-05-24T22:59:07Z", ship_ids_exact: ["2679690622826529803"], source: "battle.summary" }),
      {
        localId: 1885,
        observedAt: "2026-05-24T22:59:08Z",
        source: "battle.summary",
        shipId: 2682548280591992300,
      } as FleetShipRecentCombatBattleInput & { shipId: number },
    ]);

    expect(index.get("2682548280591992155")).toEqual([
      expect.objectContaining({ localId: 1880 }),
    ]);
    expect(index.get("2679690622826529803")).toEqual([
      expect.objectContaining({ localId: 1884 }),
    ]);
    expect(index.has("2682548280591992300")).toBe(false);
  });

  it("summarizes battle report events using preserved ship_ids_exact fields", () => {
    const summary = summarizeBattleReportEventForRecentCombat(battleReportEvent(), { localId: 1880 });

    expect(summary).toEqual({
      localId: 1880,
      observedAt: "2026-05-24T22:58:50Z",
      outcome: "initiator_victory",
      opponentName: "Lv.55 SurgeHostile Survey",
      opponentType: "hostile",
      rounds: 1,
      shipIdsExact: ["2682548280591992155"],
      source: "battle.report",
    });
  });
});

function fleetRow(overrides: Partial<FleetProjectionSlot> = {}): FleetProjectionSlot {
  return {
    slotKey: "slot-0",
    fleetKey: "fleet-0",
    state: "idleinspace",
    assignmentKind: "player_ship",
    updatedAt: "2026-05-24T22:58:50Z",
    ...overrides,
  };
}

function battleInput(overrides: Partial<FleetShipRecentCombatBattleInput> = {}): FleetShipRecentCombatBattleInput {
  return {
    observedAt: "2026-05-24T22:58:50Z",
    source: "battle.summary",
    ...overrides,
  };
}

function battleReportEvent(): BattleReportEvent {
  return {
    protocolVersion: "stfc.sidecar.events.v0",
    type: "battle.report",
    schemaVersion: "stfc.sidecar.battle-report.v0",
    timestamp: "2026-05-24T22:58:50Z",
    journalId: "battle-1880",
    battleId: "battle-1880",
    report: {
      summary: { outcome: "initiator_victory", roundCount: 1 },
      rewards: [],
      fleets: [
        {
          side: "initiator",
          participant_kind: "player",
          display_name: "USS Relativity",
          ship_ids_exact: ["2682548280591992155"],
          fleet_id_exact: "2644013931949275840",
        },
        {
          side: "target",
          participant_kind: "hostile",
          display_name: "Lv.55 SurgeHostile Survey",
          ship_ids_exact: ["0"],
        },
      ],
      events: [],
      decode: { status: "decoded_segments" },
      parity: { reference: "stfc_client_csv_export" },
    },
  };
}