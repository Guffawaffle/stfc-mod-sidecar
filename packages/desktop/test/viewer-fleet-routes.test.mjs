import { describe, expect, it, vi } from "vitest";

import { buildCompatibleFleetSyncSuccessPayload } from "../../viewer/server/fleet-broker-contract.mjs";
import { handleFleetRoutes } from "../../viewer/server/routes/fleet-routes.mjs";

describe("viewer fleet routes", () => {
    it("delegates fleet sync ingest with legacy compatibility fields preserved", async () => {
        const context = baseContext();
        const response = captureResponse();
        const request = { method: "POST" };
        await expect(handleFleetRoutes(
            request,
            response,
            new URL("http://127.0.0.1/api/fleet/sync"),
            context,
        )).resolves.toBe(true);

        expect(context.handleFleetSyncIngest).toHaveBeenCalledWith(request, response);
        expect(response.statusCode).toBe(202);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            received: 2,
            accepted: 2,
            cloudUploadEnabled: false,
            batches: 1,
            queued: 2,
            uploadEnabled: false,
            endpointConfigured: false,
            queueDepth: 2,
        });
    });

    it("returns projection state from the broker-backed read path", async () => {
        const response = captureResponse();
        const context = baseContext({
            readFleetProjection: vi.fn(async () => ({
                ok: true,
                available: true,
                generatedAt: "2026-05-18T12:00:00.000Z",
                cloudUploadEnabled: false,
                projection: {
                    projectionKey: "fleet:install-test",
                    installId: "install-test",
                    sessionId: "session-test",
                    stateVersion: 2,
                    stateHash: "hash-1",
                    observedAt: "2026-05-18T12:00:00.000Z",
                    updatedAt: "2026-05-18T12:00:00.000Z",
                    slotCount: 1,
                    slots: [{ slotKey: "ship-alpha" }],
                },
            })),
        });

        await expect(handleFleetRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/fleet/projection"),
            context,
        )).resolves.toBe(true);

        expect(context.readFleetProjection).toHaveBeenCalledTimes(1);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            available: true,
            projection: { projectionKey: "fleet:install-test", slotCount: 1 },
        });
    });

    it("returns provisional activity from the Fleet activity read path", async () => {
        const response = captureResponse();
        const context = baseContext({
            readFleetActivity: vi.fn(async (limit) => ({
                ok: true,
                source: "fleet.activity.preview",
                provisional: true,
                limit,
                items: [{ id: "battle-1", title: "Hostile", chips: ["battle.report"] }],
            })),
        });

        await expect(handleFleetRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/fleet/activity?limit=12"),
            context,
        )).resolves.toBe(true);

        expect(context.readFleetActivity).toHaveBeenCalledWith(12);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            source: "fleet.activity.preview",
            provisional: true,
            limit: 12,
            items: [{ id: "battle-1", title: "Hostile" }],
        });
    });

    it("returns exact-ID ship combat preview from the dedicated Fleet preview path", async () => {
        const response = captureResponse();
        const context = baseContext({
            readFleetShipCombatPreview: vi.fn(async () => ({
                ok: true,
                source: "fleet.ship_recent_combat.preview",
                preview: {
                    schema: "stfc.fleet.ship_recent_combat.preview.v1",
                    provisional: true,
                    matches: [{ slotKey: "slot-0", shipId: "2682548280591992155", recentBattles: [{ source: "battle.report" }] }],
                    unmatchedBattles: [],
                    unmatchedFleetRows: [],
                },
            })),
        });

        await expect(handleFleetRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/fleet/ship-combat-preview"),
            context,
        )).resolves.toBe(true);

        expect(context.readFleetShipCombatPreview).toHaveBeenCalledTimes(1);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            source: "fleet.ship_recent_combat.preview",
            preview: {
                matches: [{ slotKey: "slot-0", shipId: "2682548280591992155" }],
            },
        });
    });

    it("delegates fleet projection stream requests", async () => {
        const context = baseContext();
        const response = captureResponse();
        const request = { method: "GET" };

        await expect(handleFleetRoutes(
            request,
            response,
            new URL("http://127.0.0.1/api/fleet/stream"),
            context,
        )).resolves.toBe(true);

        expect(context.handleFleetStream).toHaveBeenCalledWith(request, response);
        expect(response.statusCode).toBe(200);
    });

    it("keeps method gates for fleet routes", async () => {
        const syncResponse = captureResponse();
        await handleFleetRoutes(
            { method: "GET" },
            syncResponse,
            new URL("http://127.0.0.1/api/fleet/sync"),
            baseContext(),
        );
        expect(syncResponse.statusCode).toBe(405);

        const projectionResponse = captureResponse();
        await handleFleetRoutes(
            { method: "POST" },
            projectionResponse,
            new URL("http://127.0.0.1/api/fleet/projection"),
            baseContext(),
        );
        expect(projectionResponse.statusCode).toBe(405);
        expect(JSON.parse(projectionResponse.body)).toEqual({ ok: false, error: "Method not allowed" });

        const activityResponse = captureResponse();
        await handleFleetRoutes(
            { method: "POST" },
            activityResponse,
            new URL("http://127.0.0.1/api/fleet/activity"),
            baseContext(),
        );
        expect(activityResponse.statusCode).toBe(405);
        expect(JSON.parse(activityResponse.body)).toEqual({ ok: false, error: "Method not allowed" });

        const combatPreviewResponse = captureResponse();
        await handleFleetRoutes(
            { method: "POST" },
            combatPreviewResponse,
            new URL("http://127.0.0.1/api/fleet/ship-combat-preview"),
            baseContext(),
        );
        expect(combatPreviewResponse.statusCode).toBe(405);
        expect(JSON.parse(combatPreviewResponse.body)).toEqual({ ok: false, error: "Method not allowed" });

        const streamResponse = captureResponse();
        await handleFleetRoutes(
            { method: "POST" },
            streamResponse,
            new URL("http://127.0.0.1/api/fleet/stream"),
            baseContext(),
        );
        expect(streamResponse.statusCode).toBe(405);
        expect(JSON.parse(streamResponse.body)).toEqual({ ok: false, error: "Method not allowed" });
    });

    it("ignores unrelated routes", async () => {
        await expect(handleFleetRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/events"),
            baseContext(),
        )).resolves.toBe(false);
    });
});

function baseContext(overrides = {}) {
    return {
        handleFleetSyncIngest: vi.fn(async (_request, response) => {
            response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
            response.end(JSON.stringify(buildCompatibleFleetSyncSuccessPayload({
                ok: true,
                protocolVersion: "stfc.telemetry.v1",
                received: 2,
                accepted: 2,
                cloudUploadEnabled: false,
                rawStored: 2,
                duplicates: 0,
                outboxInserted: 2,
                outboxUpdated: 0,
                projectionAdvanced: 2,
                projectionNoOp: 0,
                projectionStale: 0,
            }, { queueDepth: 2 })));
        }),
        handleFleetStream: vi.fn((_request, response) => {
            response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
            response.end("stream");
        }),
        readFleetActivity: vi.fn(async () => ({ ok: true, provisional: true, items: [] })),
        readFleetShipCombatPreview: vi.fn(async () => ({
            ok: true,
            source: "fleet.ship_recent_combat.preview",
            preview: {
                schema: "stfc.fleet.ship_recent_combat.preview.v1",
                provisional: true,
                matches: [],
                unmatchedBattles: [],
                unmatchedFleetRows: [],
            },
        })),
        readFleetProjection: vi.fn(async () => ({ ok: true, available: false, projection: null })),
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
