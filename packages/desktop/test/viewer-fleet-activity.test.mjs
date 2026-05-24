import { describe, expect, test } from "vitest";

import {
    buildFleetActivitySnapshot,
    resolveFleetActivityLimit,
} from "../../viewer/server/fleet-activity.mjs";

describe("viewer fleet activity preview", () => {
    test("builds a provisional Fleet Watch view model from existing event summaries", () => {
        const snapshot = buildFleetActivitySnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            detail: "summary",
            generatedAt: "2026-05-24T20:00:00.000Z",
            totalLines: 3,
            returnedLines: 2,
            events: [
                {
                    lineNumber: 42,
                    parsed: true,
                    eventType: "battle.report",
                    battleId: "battle-42",
                    journalId: "journal-42",
                    timestamp: "2026-05-24T19:59:00.000Z",
                    rawLine: "must not leak",
                    event: { rawJson: "must not leak" },
                    summary: {
                        title: "Interceptor Hostile",
                        subtitle: "Guffawaffle",
                        chips: ["battle.report", "battleType 8", "initiator_victory"],
                        timestamp: "2026-05-24T19:59:00.000Z",
                    },
                },
                {
                    lineNumber: 43,
                    parsed: false,
                    summary: { title: "Invalid raw line", chips: ["invalid"] },
                },
            ],
        });

        expect(snapshot).toMatchObject({
            ok: true,
            source: "fleet.activity.preview",
            provisional: true,
            stability: "preview",
            dataSource: { source: "store", storageBackend: "sqlite", detail: "summary" },
            totalEvents: 3,
            eventsWindow: 2,
            returnedEvents: 1,
        });
        expect(snapshot.items).toEqual([
            {
                id: "battle-42",
                lineNumber: 42,
                eventType: "battle.report",
                battleId: "battle-42",
                journalId: "journal-42",
                timestamp: "2026-05-24T19:59:00.000Z",
                title: "Interceptor Hostile",
                subtitle: "Guffawaffle",
                chips: ["battle.report", "battleType 8", "initiator_victory"],
                status: "battle.report",
                diagnosticsHref: "/diagnostics/",
            },
        ]);
        expect(JSON.stringify(snapshot)).not.toContain("must not leak");
    });

    test("clamps activity limits for the preview endpoint", () => {
        expect(resolveFleetActivityLimit("0")).toBe(1);
        expect(resolveFleetActivityLimit("6")).toBe(6);
        expect(resolveFleetActivityLimit("999")).toBe(25);
        expect(resolveFleetActivityLimit("bad")).toBe(6);
    });
});