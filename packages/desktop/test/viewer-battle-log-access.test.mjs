import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBattleDetailSnapshot, buildBattleIndexSnapshot } from "../../viewer/server/battle-log-access.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workbenchApp = readFileSync(path.resolve(__dirname, "../../viewer/public/battle-log/workbench/app.js"), "utf8");
const explorerApp = readFileSync(path.resolve(__dirname, "../../viewer/public/battle-log/app.js"), "utf8");

describe("viewer battle log access helpers", () => {
    test("builds a lightweight battle index without raw event payloads", () => {
        const index = buildBattleIndexSnapshot(sampleSnapshot(), { limit: 10 });

        expect(index).toMatchObject({
            ok: true,
            detail: "battle-index",
            totalBattles: 1,
            returnedBattles: 1,
        });
        expect(index.battles[0]).toMatchObject({
            battleId: "battle-1",
            battleType: 2,
            completeness: {
                hasCapture: true,
                hasReport: true,
                hasCatalog: true,
                hasAnalytics: true,
            },
        });
        expect(index.battles[0]).not.toHaveProperty("event");
        expect(index.battles[0]).not.toHaveProperty("rawJson");
        expect(JSON.stringify(index.battles[0])).not.toContain("battleLog");
    });

    test("builds lazy battle detail with full raw and enriched events", () => {
        const detail = buildBattleDetailSnapshot(sampleSnapshot(), "battle-1");

        expect(detail).toMatchObject({
            ok: true,
            detail: "battle-detail",
            battleId: "battle-1",
        });
        expect(detail).toHaveProperty("derivedViews.battleExplanation");
        expect(detail).not.toHaveProperty("battleExplanation");
        expect(detail.events).toHaveLength(4);
        expect(detail.events[0].event.capture.battleLog.tokens).toEqual(["1", "2"]);
        expect(detail.events.map((entry) => entry.event.type)).toEqual([
            "battle.capture",
            "battle.report",
            "catalog.snapshot",
            "battle.analytics",
        ]);
    });

    test("keeps Workbench on battle index startup and lazy detail loading", () => {
        expect(workbenchApp).toContain("fetch(`/api/battles?limit=${limit}`");
        expect(workbenchApp).toContain("new EventSource(\"/api/events/stream\")");
        expect(workbenchApp).toContain("fetch(`/api/battles/${encodeURIComponent(group.key)}`");
        expect(workbenchApp).not.toContain("fetch(`/api/events?limit=${limit}&detail=summary`");
        expect(workbenchApp).toContain("window.setInterval");
        expect(workbenchApp).toContain("Name Source");
        expect(workbenchApp).toContain("Runtime effects are structurally matched observations, not final proc-rate/math.");
    });

    test("adds raw JSON copy without changing Explorer lazy event detail", () => {
        expect(explorerApp).toContain("Copy JSON");
        expect(explorerApp).toContain("navigator.clipboard.writeText");
        expect(explorerApp).toContain("fetch(`/api/events/${entry.lineNumber}`");
        expect(explorerApp).toContain("new EventSource(\"/api/events/stream\")");
        expect(explorerApp).toContain("Open Battle Workbench");
        expect(explorerApp).toContain("derived explanation surface");
        expect(explorerApp).not.toContain("unknownScalarA");
        expect(explorerApp).not.toContain("unknownScalarB");
        expect(workbenchApp).not.toContain("unknownScalarA");
        expect(workbenchApp).not.toContain("unknownScalarB");
    });
});

function sampleSnapshot() {
    return {
        ok: true,
        source: "store",
        storageBackend: "sqlite",
        generatedAt: "2026-06-04T20:00:00.000Z",
        totalLines: 4,
        events: [
            eventEntry(1, {
                type: "battle.capture",
                battleId: "battle-1",
                journalId: "journal-1",
                battleType: 2,
                timestamp: "2026-06-04T20:00:00.000Z",
                capture: {
                    participants: [{ name: "Guffawaffle" }],
                    battleLog: { tokens: ["1", "2"] },
                    summary: { targetId: "mar_9" },
                },
            }),
            eventEntry(2, {
                type: "battle.report",
                battleId: "battle-1",
                journalId: "journal-1",
                battleType: 2,
                timestamp: "2026-06-04T20:00:01.000Z",
                report: { summary: { outcome: "initiator_victory" } },
            }, "Lv.9 Hostile", "Guffawaffle"),
            eventEntry(3, {
                type: "catalog.snapshot",
                battleId: "battle-1",
                journalId: "journal-1",
                battleType: 2,
                timestamp: "2026-06-04T20:00:02.000Z",
                catalog: { coverage: { resolvedEntries: 3, totalEntries: 4 } },
            }),
            eventEntry(4, {
                type: "battle.analytics",
                battleId: "battle-1",
                journalId: "journal-1",
                battleType: 2,
                timestamp: "2026-06-04T20:00:03.000Z",
                analytics: { csvParity: { rows: [{ round: 1 }] } },
            }),
        ],
    };
}

function eventEntry(lineNumber, event, title = event.type, subtitle = "") {
    return {
        parsed: true,
        lineNumber,
        event,
        eventType: event.type,
        battleId: event.battleId,
        journalId: event.journalId,
        battleType: event.battleType,
        timestamp: event.timestamp,
        summary: {
            title,
            subtitle,
            timestamp: event.timestamp,
            chips: [event.type],
        },
    };
}
