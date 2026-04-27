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
    }
  });
});
