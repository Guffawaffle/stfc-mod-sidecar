import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    countFleetRuntimeMajelEnvelopes,
    createFleetTelemetryBroker,
    createSqlFleetBrokerStore,
} from "../../core/src/index.ts";
import { createMajelIngestStore } from "../../viewer/majel-ingest-store.mjs";
import { ingestAcceptedMajelPayload } from "../../viewer/server/majel-ingest-bridge.mjs";
import { handleFleetRoutes } from "../../viewer/server/routes/fleet-routes.mjs";

const tempDirs = [];

afterEach(() => {
    while (tempDirs.length > 0) {
        rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
    }
});

describe("viewer Majel fleet bridge", () => {
    it("stores accepted fleet runtime envelopes and advances the fleet projection read path", async () => {
        const majelIngestStore = createMajelIngestStore({ now: fixedClock("2026-05-18T12:06:00.000Z") });
        const fleetBroker = await createFleetBroker();

        const result = await ingestAcceptedMajelPayload({
            payload: runtimeEnvelope(),
            majelIngestStore,
            fleetBroker,
            countFleetRuntimeMajelEnvelopes,
        });

        expect(result.majelResult).toMatchObject({
            ok: true,
            accepted: 1,
            totalEnvelopes: 1,
            storedEnvelopes: 1,
            rejectedEnvelopes: 0,
        });
        expect(result.fleetBrokerResult).toMatchObject({
            ok: true,
            received: 1,
            accepted: 1,
            projectionAdvanced: 1,
        });
        expect(majelIngestStore.snapshot().events[0].summary.schema).toBe("stfc.fleet.runtime_snapshot.v1");

        const fleetResponse = captureResponse();
        await handleFleetRoutes(
            { method: "GET" },
            fleetResponse,
            new URL("http://127.0.0.1/api/fleet/projection"),
            { readFleetProjection: () => fleetBroker.readProjection() },
        );

        const body = JSON.parse(fleetResponse.body);
        expect(fleetResponse.statusCode).toBe(200);
        expect(body).toMatchObject({
            ok: true,
            available: true,
            projection: {
                installId: "install-test",
                sessionId: "mod-session-1",
                slotCount: 10,
                stateVersion: 17,
            },
        });
        expect(body.projection.slots.filter((slot) => slot.state === "docked")).toHaveLength(5);
        expect(body.projection.slots.filter((slot) => slot.state === "mining")).toHaveLength(1);
        expect(body.projection.slots.filter((slot) => slot.state === "warping")).toHaveLength(1);
        expect(body.projection.slots.filter((slot) => slot.state === "empty")).toHaveLength(3);
        expect(fleetResponse.body).not.toContain("secret-sync-token");
        expect(fleetResponse.body).not.toContain("coordinates");
        expect(fleetResponse.body).not.toContain("payload");

        await fleetBroker.close();
    });

    it("leaves fleet projection unchanged for unrelated accepted Majel envelopes", async () => {
        const majelIngestStore = createMajelIngestStore({ now: fixedClock("2026-05-18T12:06:00.000Z") });
        const fleetBroker = await createFleetBroker();

        const result = await ingestAcceptedMajelPayload({
            payload: capabilityEnvelope(),
            majelIngestStore,
            fleetBroker,
            countFleetRuntimeMajelEnvelopes,
        });

        expect(result.majelResult).toMatchObject({ ok: true, accepted: 1, totalEnvelopes: 1 });
        expect(result.fleetBrokerResult).toBeNull();
        expect(await fleetBroker.readProjection()).toMatchObject({
            ok: true,
            available: false,
            projection: null,
        });

        await fleetBroker.close();
    });

    it("keeps accepted Majel ingest durable even if the fleet bridge fails", async () => {
        const majelIngestStore = createMajelIngestStore({ now: fixedClock("2026-05-18T12:06:00.000Z") });
        const fleetBroker = {
            ingestFleetRuntimePayload: vi.fn(async () => {
                throw new Error("projection bridge failed");
            }),
        };

        const result = await ingestAcceptedMajelPayload({
            payload: runtimeEnvelope(),
            majelIngestStore,
            fleetBroker,
            countFleetRuntimeMajelEnvelopes,
        });

        expect(result.majelResult).toMatchObject({ ok: true, accepted: 1, storedEnvelopes: 1 });
        expect(result.fleetBrokerResult).toBeNull();
        expect(result.bridgeError).toBeInstanceOf(Error);
        expect(majelIngestStore.snapshot().totalEnvelopes).toBe(1);
    });
});

async function createFleetBroker() {
    const store = await createSqlFleetBrokerStore({
        backend: "sqlite",
        connection: makeTempPath("viewer-majel-bridge.sqlite"),
    });
    return createFleetTelemetryBroker({
        store,
        installId: "install-test",
        sessionId: "viewer-session",
        sidecarVersion: "0.1.0-test",
        cloudUploadEnabled: false,
        now: fixedClock("2026-05-18T12:06:00.000Z"),
    });
}

function makeTempPath(fileName) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "stfc-viewer-majel-bridge-"));
    tempDirs.push(dir);
    return path.join(dir, fileName);
}

function fixedClock(value) {
    return () => new Date(value);
}

function runtimeEnvelope() {
    return {
        protocolVersion: "majel.ingest.v1",
        eventId: "runtime-event-1",
        source: "stfc-community-mod",
        sourceVersion: "2.0.1-test",
        installId: "not_configured",
        sessionId: "mod-session-1",
        sequence: 17,
        observedAt: "2026-05-18T12:05:00.000Z",
        schema: "stfc.fleet.runtime_snapshot.v1",
        classification: "cloud_private",
        payload: {
            type: "fleet.runtime",
            schemaVersion: "stfc.fleet.runtime_snapshot.v1",
            source: "deployment-battle-end-event",
            observedAtMs: 1747569900000,
            fleetBarTracked: true,
            selectedIndex: 3,
            slots: [
                { slotIndex: 0, present: true, fleetId: 1000, currentStateName: "Docked", hullName: "Enterprise", token: "secret-sync-token" },
                { slotIndex: 1, present: true, fleetId: 1001, currentStateName: "Docked", hullName: "Defiant" },
                { slotIndex: 2, present: true, fleetId: 1002, currentStateName: "Docked", hullName: "Voyager" },
                { slotIndex: 3, present: true, fleetId: 1003, currentStateName: "Warping", hullName: "Discovery", coordinates: { x: 1, y: 2 } },
                { slotIndex: 4, present: true, fleetId: 1004, currentStateName: "Docked", hullName: "Franklin" },
                { slotIndex: 5, present: true, fleetId: 1005, currentStateName: "Docked", hullName: "Meridian" },
                { slotIndex: 6, present: true, fleetId: 1006, currentStateName: "Mining", hullName: "Botany Bay" },
                { slotIndex: 7, present: false },
                { slotIndex: 8, present: false },
                { slotIndex: 9, present: false },
            ],
        },
    };
}

function capabilityEnvelope() {
    return {
        protocolVersion: "majel.ingest.v1",
        eventId: "capability-event-1",
        source: "stfc-community-mod",
        sourceVersion: "2.0.1-test",
        installId: "not_configured",
        sessionId: "mod-session-1",
        sequence: 18,
        observedAt: "2026-05-18T12:07:00.000Z",
        schema: "stfc.mod.capability_snapshot.v1",
        classification: "cloud_private",
        payload: {
            schemaVersion: "stfc.mod.capability_snapshot.v1",
            targets: [{ name: "sidecar", mode: "sidecar_broker", enabledSyncTypes: ["fleet_runtime"] }],
        },
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