import { describe, expect, it } from "vitest";

import { parseEventJsonLine } from "../events/schema.js";
import { parseBattleLogLine, parseBattleLogText } from "./parser.js";

const timestamp = "2026-04-26T00:00:00.000Z";

describe("battle-log parser", () => {
  it("preserves unknown lines without inventing structure", () => {
    const event = parseBattleLogLine("some future STFC line shape we do not know", { timestamp });

    expect(event.phase).toBe("unknown");
    expect(event.parseStatus).toBe("unparsed");
    expect(event.rawLine).toBe("some future STFC line shape we do not know");
    expect(event.damage).toBeUndefined();
    expect(event.playerShip).toBeUndefined();
    expect(event.enemy).toBeUndefined();
  });

  it("extracts explicit battle id and started phase", () => {
    const event = parseBattleLogLine("battleId=sample-001 combat started playerShip=USS Example enemy=Hostile Surveyor", {
      timestamp,
      sessionId: "test-session",
      source: "unit-test",
    });

    expect(event.battleId).toBe("sample-001");
    expect(event.phase).toBe("started");
    expect(event.playerShip).toBe("USS Example");
    expect(event.enemy).toBe("Hostile Surveyor");
    expect(event.parseStatus).toBe("parsed");
  });

  it("extracts round numbers from explicit round lines", () => {
    const event = parseBattleLogLine("Round 2", { timestamp });

    expect(event.phase).toBe("round");
    expect(event.round).toBe(2);
  });

  it("extracts damage without assuming participants", () => {
    const event = parseBattleLogLine("Critical hit: 1,240 damage", { timestamp });

    expect(event.phase).toBe("crit");
    expect(event.damage?.total).toBe(1240);
    expect(event.damage?.raw).toBe("1,240 damage");
    expect(event.playerShip).toBeUndefined();
    expect(event.enemy).toBeUndefined();
  });

  it("marks mitigation lines separately when explicit", () => {
    const event = parseBattleLogLine("Mitigation: shield absorbed 320 damage", { timestamp });

    expect(event.phase).toBe("mitigation");
    expect(event.damage?.total).toBe(320);
  });

  it("parses multi-line text and records line numbers", () => {
    const events = parseBattleLogText("Round 1\nUnknown shape", { timestamp, firstLineNumber: 10 });

    expect(events).toHaveLength(2);
    expect(events[0].round).toBe(1);
    expect(events[0].parser?.lineNumber).toBe(10);
    expect(events[1].parseStatus).toBe("unparsed");
    expect(events[1].parser?.lineNumber).toBe(11);
  });

  it("accepts mod-emitted battle report feed events", () => {
    const line = JSON.stringify({
      protocolVersion: "stfc.sidecar.events.v0",
      type: "battle.report",
      schemaVersion: "stfc.sidecar.battle-report.v0",
      timestamp,
      source: "stfc-community-mod",
      journalId: "2709118446356718841",
      battleId: "2709118446356718841",
      battleType: 8,
      report: {
        summary: { outcome: "initiator_victory" },
        rewards: [{ kind: "resource", resourceId: "2431852293", count: 263028 }],
        fleets: [{ side: "initiator", name: "Guffawaffle" }],
        events: [{ index: 0, markers: [-96, -90, -89] }],
        csvParity: {
          reference: "stfc_client_csv_export",
          status: "partial",
          rows: [{ round: "1", type: "Attack", hullDamage: "1878" }],
        },
        decode: { status: "decoded_segments" },
        parity: {
          reference: "stfc_client_csv_export",
          sections: { battleSummary: "structured", battleEvents: "decoded_segments" },
        },
      },
    });

    const parsed = parseEventJsonLine(line);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.event.type).toBe("battle.report");
      expect(parsed.event.journalId).toBe("2709118446356718841");
      expect(parsed.event.report.csvParity).toEqual({
        reference: "stfc_client_csv_export",
        status: "partial",
        rows: [{ round: "1", type: "Attack", hullDamage: "1878" }],
      });
    }
  });

  it("accepts mod-emitted battle analytics feed events with CSV parity rows", () => {
    const line = JSON.stringify({
      protocolVersion: "stfc.sidecar.events.v0",
      type: "battle.analytics",
      schemaVersion: "stfc.battle.analytics.v0",
      timestamp,
      source: "stfc-community-mod",
      journalId: "2709118446356718841",
      battleId: "2709118446356718841",
      battleType: 8,
      analytics: {
        summary: { roundCount: 2 },
        csvParity: {
          reference: "stfc_client_csv_export",
          status: "partial",
          rows: [{ round: "1", battleEvent: "1", type: "Attack", attackerName: "Guffawaffle" }],
          coverage: { attackRecordCount: 1, csvParityRowCount: 1, catalogResolved: false },
        },
      },
    });

    const parsed = parseEventJsonLine(line);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.event.type).toBe("battle.analytics");
      expect(parsed.event.journalId).toBe("2709118446356718841");
      expect(parsed.event.analytics.csvParity).toEqual({
        reference: "stfc_client_csv_export",
        status: "partial",
        rows: [{ round: "1", battleEvent: "1", type: "Attack", attackerName: "Guffawaffle" }],
        coverage: { attackRecordCount: 1, csvParityRowCount: 1, catalogResolved: false },
      });
    }
  });

  it("accepts mod-emitted battle capture feed events with string tokens", () => {
    const line = JSON.stringify({
      protocolVersion: "stfc.sidecar.events.v0",
      type: "battle.capture",
      schemaVersion: "stfc.battle.capture.v1",
      timestamp,
      source: "stfc-community-mod",
      journalId: "2709118446356718841",
      battleId: "2709118446356718841",
      battleType: 8,
      capturedAtUnixMs: 222,
      capture: {
        sourceKind: "scopely.journal.battle",
        summary: { targetId: "mar_45" },
        battleLog: {
          encoding: "string_tokens.v1",
          tokenCount: 3,
          tokens: ["-96", "2682660367670527124", "-97"],
        },
        journal: {
          encoding: "lossless_integer_strings.v1",
          omittedKeys: ["battle_log"],
          data: { id: "2709118446356718841" },
        },
      },
    });

    const parsed = parseEventJsonLine(line);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.event.type).toBe("battle.capture");
      expect(parsed.event.journalId).toBe("2709118446356718841");
      expect(parsed.event.capture.battleLog?.tokens[1]).toBe("2682660367670527124");
    }
  });

  it("accepts mod-emitted catalog snapshot events with observed IDs and resolved players", () => {
    const line = JSON.stringify({
      protocolVersion: "stfc.sidecar.events.v0",
      type: "catalog.snapshot",
      schemaVersion: "stfc.catalog.snapshot.v0",
      timestamp,
      source: "stfc-community-mod",
      journalId: "2709118446356718841",
      battleId: "2709118446356718841",
      battleType: 8,
      capturedAtUnixMs: 222,
      scope: "battle",
      catalog: {
        domains: {
          hulls: { "77": { id: "77", unresolved: true } },
          ships: { "111": { id: "111", unresolved: true } },
          players: {
            "player-1": {
              id: "player-1",
              name: "Guffawaffle",
              unresolved: false,
              allianceId: "9001",
              allianceName: "House of Test",
              allianceTag: "HOT",
            },
          },
          alliances: {
            "9001": { id: "9001", name: "House of Test", tag: "HOT", unresolved: false },
          },
        },
        coverage: {
          domainsPresent: ["hulls", "ships", "players", "alliances"],
          domainsResolved: ["players", "alliances"],
          domainsUnresolved: ["hulls", "ships"],
          totalEntries: 4,
          resolvedEntries: 2,
        },
        provenance: {
          source: "stfc-community-mod catalog_snapshot",
          ruleVersion: "catalog_observed_ids.v1",
        },
      },
    });

    const parsed = parseEventJsonLine(line);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.event.type).toBe("catalog.snapshot");
      expect(parsed.event.journalId).toBe("2709118446356718841");
      expect(parsed.event.scope).toBe("battle");
      expect(parsed.event.catalog.domains.players?.["player-1"]?.name).toBe("Guffawaffle");
      expect(parsed.event.catalog.domains.hulls?.["77"]?.unresolved).toBe(true);
      expect(parsed.event.catalog.coverage.totalEntries).toBe(4);
    }
  });
});
