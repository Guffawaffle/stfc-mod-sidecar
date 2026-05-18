import { describe, expect, it, vi } from "vitest";

import { createMajelIngestStore } from "../../viewer/majel-ingest-store.mjs";
import { handleMajelRoutes } from "../../viewer/server/routes/majel-routes.mjs";

describe("Majel ingest store", () => {
    it("accepts valid Majel envelopes and exposes bounded summaries plus detail", () => {
        const store = createMajelIngestStore({
            maxEntries: 2,
            now: fixedClock("2026-05-18T12:00:00.000Z"),
        });

        const first = store.ingest(validEnvelope({ sequence: 1, schema: "stfc.mod.capability_snapshot.v1" }));
        const second = store.ingest(validEnvelope({ sequence: 2, schema: "stfc.fleet.runtime_snapshot.v1" }));
        const third = store.ingest(validEnvelope({ sequence: 3, schema: "stfc.fleet.assignment_snapshot.v1" }));

        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);
        expect(third.localIds).toEqual([3]);

        const snapshot = store.snapshot(10);
        expect(snapshot.totalEnvelopes).toBe(3);
        expect(snapshot.storedEnvelopes).toBe(2);
        expect(snapshot.events.map((entry) => entry.localId)).toEqual([3, 2]);
        expect(snapshot.events[0].summary.schema).toBe("stfc.fleet.assignment_snapshot.v1");

        expect(store.detail(1)).toBeNull();
        expect(store.detail(3).event.envelope.schema).toBe("stfc.fleet.assignment_snapshot.v1");
    });

    it("rejects envelopes outside the Majel contract without storing raw payloads", () => {
        const store = createMajelIngestStore({ now: fixedClock("2026-05-18T12:00:00.000Z") });
        const result = store.ingest({ protocolVersion: "stfc.sidecar.events.v0" });

        expect(result.ok).toBe(false);
        expect(result.status).toBe("rejected");
        expect(result.error).toContain("protocolVersion majel.ingest.v1");

        const snapshot = store.snapshot();
        expect(snapshot.rejectedEnvelopes).toBe(1);
        expect(snapshot.storedEnvelopes).toBe(0);
        expect(snapshot.lastRejectedError).toBe(result.error);
    });

    it("accepts existing sync shapes that use array payloads", () => {
        const store = createMajelIngestStore({ now: fixedClock("2026-05-18T12:00:00.000Z") });
        const result = store.ingest(validEnvelope({
            schema: "stfc.battle.summary.v1",
            payload: [{ battleId: "battle-1", outcome: "victory" }],
        }));

        expect(result.ok).toBe(true);
        expect(store.detail(1).event.envelope.payload).toEqual([{ battleId: "battle-1", outcome: "victory" }]);
    });
});

describe("Majel viewer routes", () => {
    it("delegates ingest, snapshot, stream, and detail requests", async () => {
        const context = baseContext();

        const ingestResponse = captureResponse();
        const ingestRequest = { method: "POST" };
        await expect(handleMajelRoutes(
            ingestRequest,
            ingestResponse,
            new URL("http://127.0.0.1/api/majel/ingest"),
            context,
        )).resolves.toBe(true);
        expect(context.handleMajelIngest).toHaveBeenCalledWith(ingestRequest, ingestResponse);
        expect(ingestResponse.statusCode).toBe(202);

        const snapshotResponse = captureResponse();
        await handleMajelRoutes(
            { method: "GET" },
            snapshotResponse,
            new URL("http://127.0.0.1/api/majel/events?limit=25"),
            context,
        );
        expect(context.readMajelSnapshot).toHaveBeenCalledWith(25);
        expect(snapshotResponse.statusCode).toBe(200);
        expect(JSON.parse(snapshotResponse.body)).toEqual({ ok: true, route: "majel" });

        const streamResponse = captureResponse();
        const streamRequest = { method: "GET" };
        await handleMajelRoutes(
            streamRequest,
            streamResponse,
            new URL("http://127.0.0.1/api/majel/stream"),
            context,
        );
        expect(context.handleMajelStream).toHaveBeenCalledWith(streamRequest, streamResponse);
        expect(streamResponse.statusCode).toBe(200);

        const detailResponse = captureResponse();
        await handleMajelRoutes(
            { method: "GET" },
            detailResponse,
            new URL("http://127.0.0.1/api/majel/events/7"),
            context,
        );
        expect(context.readMajelDetail).toHaveBeenCalledWith(7);
        expect(detailResponse.statusCode).toBe(200);
    });

    it("keeps method gates and ignores unrelated routes", async () => {
        const ingestResponse = captureResponse();
        await handleMajelRoutes(
            { method: "GET" },
            ingestResponse,
            new URL("http://127.0.0.1/api/majel/ingest"),
            baseContext(),
        );
        expect(ingestResponse.statusCode).toBe(405);

        const eventsResponse = captureResponse();
        await handleMajelRoutes(
            { method: "POST" },
            eventsResponse,
            new URL("http://127.0.0.1/api/majel/events"),
            baseContext(),
        );
        expect(eventsResponse.statusCode).toBe(405);

        const streamResponse = captureResponse();
        await handleMajelRoutes(
            { method: "POST" },
            streamResponse,
            new URL("http://127.0.0.1/api/majel/stream"),
            baseContext(),
        );
        expect(streamResponse.statusCode).toBe(405);

        await expect(handleMajelRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/events"),
            baseContext(),
        )).resolves.toBe(false);
    });
});

function validEnvelope(overrides = {}) {
    return {
        protocolVersion: "majel.ingest.v1",
        eventId: "event-1",
        source: "stfc-community-mod",
        sourceVersion: "2.0.1-guffa.1",
        installId: "not_configured",
        sessionId: "session-1",
        sequence: 1,
        observedAt: "2026-05-18T11:59:00.000Z",
        schema: "stfc.mod.capability_snapshot.v1",
        classification: "cloud_private",
        payload: {},
        ...overrides,
    };
}

function fixedClock(value) {
    return () => new Date(value);
}

function baseContext(overrides = {}) {
    return {
        defaultLimit: 150,
        handleMajelIngest: vi.fn(async (_request, response) => {
            response.writeHead(202, {});
            response.end("accepted");
        }),
        handleMajelStream: vi.fn((_request, response) => {
            response.writeHead(200, {});
            response.end("stream");
        }),
        readMajelDetail: vi.fn(() => ({ ok: true, event: { localId: 7 } })),
        readMajelSnapshot: vi.fn(() => ({ ok: true, route: "majel" })),
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
