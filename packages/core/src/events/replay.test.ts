import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseEventJsonLine } from "./schema.js";
import {
  BATTLE_ANALYTICS_SCHEMA_VERSION,
  BATTLE_CAPTURE_SCHEMA_VERSION,
  BATTLE_REPORT_SCHEMA_VERSION,
  CATALOG_SNAPSHOT_SCHEMA_VERSION,
  SIDECAR_EVENT_PROTOCOL_VERSION,
  type BattleCaptureEvent,
  type SidecarEvent,
} from "./types.js";

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples/sample-battle-events.jsonl");

function readFixtureLines(): string[] {
  return readFileSync(fixturePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
}

function parseFixture(): SidecarEvent[] {
  return readFixtureLines().map((line) => {
    const parsed = parseEventJsonLine(line);
    expect(parsed.ok, parsed.ok ? undefined : parsed.error).toBe(true);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }

    return parsed.event;
  });
}

describe("sample battle feed replay contract", () => {
  it("parses every non-empty sample feed line", () => {
    const events = parseFixture();

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.protocolVersion === SIDECAR_EVENT_PROTOCOL_VERSION)).toBe(true);
    expect(events.every((event) => typeof event.timestamp === "string" && event.timestamp.length > 0)).toBe(true);
  });

  it("covers the battle feed event families consumed by the viewer", () => {
    const eventTypes = new Set(parseFixture().map((event) => event.type));

    expect(eventTypes.has("battle.capture")).toBe(true);
    expect(eventTypes.has("battle.report")).toBe(true);
    expect(eventTypes.has("battle.analytics")).toBe(true);
    expect(eventTypes.has("catalog.snapshot")).toBe(true);
  });

  it("preserves canonical battle capture identifiers and tokens as strings", () => {
    const captures = parseFixture().filter((event): event is BattleCaptureEvent => event.type === "battle.capture");

    expect(captures.length).toBeGreaterThan(0);
    for (const event of captures) {
      expect(event.schemaVersion).toBe(BATTLE_CAPTURE_SCHEMA_VERSION);
      expect(typeof event.journalId).toBe("string");
      expect(event.battleId === undefined || typeof event.battleId === "string").toBe(true);
      expect(event.capture.battleLog?.encoding).toBe("string_tokens.v1");
      expect(event.capture.battleLog?.tokens.every((token) => typeof token === "string")).toBe(true);
      if (event.capture.battleLog?.tokenCount !== undefined) {
        expect(event.capture.battleLog.tokenCount).toBe(event.capture.battleLog.tokens.length);
      }
    }
  });

  it("keeps schema versions explicit for versioned feed families", () => {
    const events = parseFixture();

    expect(events.find((event) => event.type === "battle.capture")?.schemaVersion).toBe(BATTLE_CAPTURE_SCHEMA_VERSION);
    expect(events.find((event) => event.type === "battle.report")?.schemaVersion).toBe(BATTLE_REPORT_SCHEMA_VERSION);
    expect(events.find((event) => event.type === "battle.analytics")?.schemaVersion).toBe(BATTLE_ANALYTICS_SCHEMA_VERSION);
    expect(events.find((event) => event.type === "catalog.snapshot")?.schemaVersion).toBe(CATALOG_SNAPSHOT_SCHEMA_VERSION);
  });
});