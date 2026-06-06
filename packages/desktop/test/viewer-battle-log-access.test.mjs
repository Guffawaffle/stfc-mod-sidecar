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
            effectiveSource: "sqlite",
            sourceDiagnostics: {
                key: "sqlite",
                fallbackActive: false,
            },
            totalBattles: 1,
            returnedBattles: 1,
        });
        expect(index.battles[0]).toMatchObject({
            battleId: "battle-1",
            capturedAtUnixMs: 1777334400000,
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

    test("builds lazy battle detail with raw events and derived views", () => {
        const detail = buildBattleDetailSnapshot(sampleSnapshot(), "battle-1");

        expect(detail).toMatchObject({
            ok: true,
            detail: "battle-detail",
            battleId: "battle-1",
            effectiveSource: "sqlite",
            sourceDiagnostics: {
                key: "sqlite",
                fallbackActive: false,
            },
        });
        expect(detail).not.toHaveProperty("runtimeEffectOverlay");
        expect(detail).toHaveProperty("derivedViews.runtimeEffectOverlay");
        expect(detail).toHaveProperty("derivedViews.battleExplanation");
        expect(detail).toHaveProperty("derivedViews.battleTimeline");
        expect(detail).not.toHaveProperty("battleExplanation");
        expect(detail.events).toHaveLength(4);
        expect(detail.events[0].event.capture.battleLog.tokens).toEqual(["1", "2"]);
        expect(detail.events.map((entry) => entry.event.type)).toEqual([
            "battle.capture",
            "battle.report",
            "catalog.snapshot",
            "battle.analytics",
        ]);
        expect(detail.events[3].event.analytics).not.toHaveProperty("resolvedRuntimeEffects");
        expect(detail.events[3].event.analytics).not.toHaveProperty("resolvedRuntimeEffectSummary");
        expect(detail.events[3].event.analytics).not.toHaveProperty("resolvedRuntimeEffectCoverage");
    });

    test("keeps Workbench on battle index startup and lazy detail loading", () => {
        expect(workbenchApp).toContain("fetch(`/api/battles?limit=${limit}`");
        expect(workbenchApp).toContain("new EventSource(\"/api/events/stream\")");
        expect(workbenchApp).toContain("fetch(`/api/battles/${encodeURIComponent(group.key)}`");
        expect(workbenchApp).not.toContain("fetch(`/api/events?limit=${limit}&detail=summary`");
        expect(workbenchApp).toContain("window.setInterval");
        expect(workbenchApp).toContain("Name Source");
        expect(workbenchApp).toContain("Runtime effects are structurally matched observations, not final proc-rate/math.");
        expect(workbenchApp).toContain("Native-Style Battle Events");
        expect(workbenchApp).toContain("Unresolved runtime candidates");
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

    test("marks explicit JSONL fallback battle snapshots without pretending they came from the store", () => {
        const fallbackIndex = buildBattleIndexSnapshot({
            ...sampleSnapshot(),
            source: "jsonl_fallback",
            storageBackend: null,
            feedPath: "C:/Games/STFC/game/community_patch_battle_feed.jsonl",
        }, { limit: 10 });

        const fallbackDetail = buildBattleDetailSnapshot({
            ...sampleSnapshot(),
            source: "jsonl_fallback",
            storageBackend: null,
            feedPath: "C:/Games/STFC/game/community_patch_battle_feed.jsonl",
        }, "battle-1");

        expect(fallbackIndex).toMatchObject({
            source: "jsonl_fallback",
            effectiveSource: "jsonl_fallback",
            sourceDiagnostics: {
                key: "jsonl_fallback",
                fallbackActive: true,
            },
        });
        expect(fallbackDetail).toMatchObject({
            source: "jsonl_fallback",
            effectiveSource: "jsonl_fallback",
            sourceDiagnostics: {
                key: "jsonl_fallback",
                fallbackActive: true,
            },
        });
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
                capturedAtUnixMs: 1777334400000,
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
                capturedAtUnixMs: 1777334400000,
                report: { summary: { outcome: "initiator_victory" } },
            }, "Lv.9 Hostile", "Guffawaffle"),
            eventEntry(3, {
                type: "catalog.snapshot",
                battleId: "battle-1",
                journalId: "journal-1",
                battleType: 2,
                timestamp: "2026-06-04T20:00:02.000Z",
                capturedAtUnixMs: 1777334400000,
                catalog: { coverage: { resolvedEntries: 3, totalEntries: 4 } },
            }),
            eventEntry(4, {
                type: "battle.analytics",
                battleId: "battle-1",
                journalId: "journal-1",
                battleType: 2,
                timestamp: "2026-06-04T20:00:03.000Z",
                capturedAtUnixMs: 1777334400000,
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
        capturedAtUnixMs: event.capturedAtUnixMs,
        timestamp: event.timestamp,
        summary: {
            title,
            subtitle,
            timestamp: event.timestamp,
            chips: [event.type],
        },
    };
}
