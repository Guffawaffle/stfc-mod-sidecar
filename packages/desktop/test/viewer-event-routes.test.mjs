import { describe, expect, it, vi } from "vitest";

import { handleEventRoutes } from "../../viewer/server/routes/event-routes.mjs";

describe("viewer event routes", () => {
    it("serves lightweight battle indexes and lazy battle details", async () => {
        const context = baseContext({
            readBattleIndex: vi.fn(async () => ({
                ok: true,
                detail: "battle-index",
                battles: [{
                    battleId: "battle-1",
                    completeness: { hasCapture: true, hasReport: true, hasCatalog: false, hasAnalytics: false },
                }],
            })),
            readBattleDetail: vi.fn(async (battleId) => ({
                ok: true,
                detail: "battle-detail",
                battleId,
                events: [{ event: { type: "battle.capture", capture: { battleLog: { tokens: ["1"] } } } }],
            })),
        });

        const indexResponse = captureResponse();
        await expect(handleEventRoutes(
            { method: "GET" },
            indexResponse,
            new URL("http://127.0.0.1/api/battles?limit=25"),
            context,
        )).resolves.toBe(true);
        expect(context.readBattleIndex).toHaveBeenCalledWith(25);
        expect(indexResponse.statusCode).toBe(200);
        const indexPayload = JSON.parse(indexResponse.body);
        expect(indexPayload.detail).toBe("battle-index");
        expect(indexPayload.battles[0]).not.toHaveProperty("event");
        expect(indexPayload.battles[0]).not.toHaveProperty("rawJson");

        const detailResponse = captureResponse();
        await handleEventRoutes(
            { method: "GET" },
            detailResponse,
            new URL("http://127.0.0.1/api/battles/battle-1"),
            context,
        );
        expect(context.readBattleDetail).toHaveBeenCalledWith("battle-1");
        expect(detailResponse.statusCode).toBe(200);
        const detailPayload = JSON.parse(detailResponse.body);
        expect(detailPayload.detail).toBe("battle-detail");
        expect(detailPayload.events[0].event.capture.battleLog.tokens).toEqual(["1"]);
    });

    it("serves event snapshots with existing limit and detail semantics", async () => {
        const context = baseContext();
        const response = captureResponse();
        await expect(handleEventRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/events?limit=25&detail=summary"),
            context,
        )).resolves.toBe(true);

        expect(context.readEventsSnapshot).toHaveBeenCalledWith(25, {
            includeDetails: false,
            eventTypes: ["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"],
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ ok: true, route: "events" });

        const invalidLimitResponse = captureResponse();
        await handleEventRoutes(
            { method: "GET" },
            invalidLimitResponse,
            new URL("http://127.0.0.1/api/events?limit=bad"),
            context,
        );
        expect(context.readEventsSnapshot).toHaveBeenLastCalledWith(150, {
            includeDetails: true,
            eventTypes: ["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"],
        });
    });

    it("requires developer mode for broad or debug event scopes", async () => {
        const response = captureResponse();
        await handleEventRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/events?scope=all"),
            baseContext({ developerMode: false }),
        );

        expect(response.statusCode).toBe(403);

        const developerResponse = captureResponse();
        const developerContext = baseContext({ developerMode: true });
        await handleEventRoutes(
            { method: "GET" },
            developerResponse,
            new URL("http://127.0.0.1/api/events?scope=debug"),
            developerContext,
        );
        expect(developerResponse.statusCode).toBe(200);
        expect(developerContext.readEventsSnapshot).toHaveBeenCalledWith(150, {
            includeDetails: true,
            eventTypes: ["debug.event", "hook.event", "session.event", "integration.event"],
        });
    });

    it("allows observed hostile event scope without developer mode", async () => {
        const context = baseContext({ developerMode: false });
        const response = captureResponse();

        await handleEventRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/events?scope=observed&detail=summary"),
            context,
        );

        expect(response.statusCode).toBe(200);
        expect(context.readEventsSnapshot).toHaveBeenCalledWith(150, {
            includeDetails: false,
            eventTypes: ["observed.hostile"],
        });
    });

    it("exposes fleet alert evidence events without developer mode", async () => {
        const context = baseContext({ developerMode: false });
        const scopeResponse = captureResponse();

        await handleEventRoutes(
            { method: "GET" },
            scopeResponse,
            new URL("http://127.0.0.1/api/events?scope=fleet-alerts&detail=summary"),
            context,
        );

        expect(scopeResponse.statusCode).toBe(200);
        expect(context.readEventsSnapshot).toHaveBeenCalledWith(150, {
            includeDetails: false,
            eventTypes: ["fleet.alert_evidence"],
        });

        const typeResponse = captureResponse();
        await handleEventRoutes(
            { method: "GET" },
            typeResponse,
            new URL("http://127.0.0.1/api/events?types=fleet.alert_evidence&limit=1"),
            context,
        );

        expect(typeResponse.statusCode).toBe(200);
        expect(context.readEventsSnapshot).toHaveBeenLastCalledWith(1, {
            includeDetails: true,
            eventTypes: ["fleet.alert_evidence"],
        });
    });

    it("delegates event ingest and stream handlers", async () => {
        const context = baseContext();
        const ingestResponse = captureResponse();
        const ingestRequest = { method: "POST" };
        await expect(handleEventRoutes(
            ingestRequest,
            ingestResponse,
            new URL("http://127.0.0.1/api/events"),
            context,
        )).resolves.toBe(true);
        expect(context.handleEventIngest).toHaveBeenCalledWith(ingestRequest, ingestResponse);
        expect(ingestResponse.statusCode).toBe(202);

        const streamResponse = captureResponse();
        const streamRequest = { method: "GET" };
        await expect(handleEventRoutes(
            streamRequest,
            streamResponse,
            new URL("http://127.0.0.1/api/events/stream"),
            context,
        )).resolves.toBe(true);
        expect(context.handleEventStream).toHaveBeenCalledWith(streamRequest, streamResponse);
        expect(streamResponse.statusCode).toBe(200);
    });

    it("keeps method gates for events and stream", async () => {
        const eventsResponse = captureResponse();
        await handleEventRoutes(
            { method: "DELETE" },
            eventsResponse,
            new URL("http://127.0.0.1/api/events"),
            baseContext(),
        );
        expect(eventsResponse.statusCode).toBe(405);

        const streamResponse = captureResponse();
        await handleEventRoutes(
            { method: "POST" },
            streamResponse,
            new URL("http://127.0.0.1/api/events/stream"),
            baseContext(),
        );
        expect(streamResponse.statusCode).toBe(405);
    });

    it("serves event detail by line number", async () => {
        const context = baseContext({
            readEventDetail: vi.fn(async (lineNumber) => ({ ok: true, event: { lineNumber } })),
        });
        const response = captureResponse();
        await expect(handleEventRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/events/42"),
            context,
        )).resolves.toBe(true);

        expect(context.readEventDetail).toHaveBeenCalledWith(42, {
            eventTypes: ["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"],
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ ok: true, event: { lineNumber: 42 } });

        const missingResponse = captureResponse();
        await handleEventRoutes(
            { method: "GET" },
            missingResponse,
            new URL("http://127.0.0.1/api/events/999"),
            baseContext({ readEventDetail: vi.fn(async () => ({ ok: false, statusCode: 410 })) }),
        );
        expect(missingResponse.statusCode).toBe(410);
    });

    it("ignores unrelated routes", async () => {
        await expect(handleEventRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/health"),
            baseContext(),
        )).resolves.toBe(false);
    });
});

function baseContext(overrides = {}) {
    return {
        defaultLimit: 150,
        developerMode: false,
        developerModeRequiredPayload: () => ({ ok: false, error: "Developer mode required" }),
        handleEventIngest: vi.fn(async (_request, response) => {
            response.writeHead(202, {});
            response.end("ingested");
        }),
        handleEventStream: vi.fn((_request, response) => {
            response.writeHead(200, {});
            response.end("stream");
        }),
        readEventDetail: vi.fn(async () => ({ ok: false, statusCode: 404 })),
        readEventsSnapshot: vi.fn(async () => ({ ok: true, route: "events" })),
        readBattleIndex: vi.fn(async () => ({ ok: true, detail: "battle-index", battles: [] })),
        readBattleDetail: vi.fn(async () => ({ ok: false, detail: "battle-detail", statusCode: 404 })),
        ...overrides,
    };
}

function captureResponse() {
    return {
        body: "",
        headers: null,
        statusCode: 0,
        writeHead(statusCode, headers) {
            this.statusCode = statusCode;
            this.headers = headers;
        },
        end(body) {
            this.body = body;
        },
    };
}
