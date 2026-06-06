import { describe, expect, it, vi } from "vitest";

import {
    ingestSidecarEnvelope,
    SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
    SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION,
    SIDECAR_INGEST_PROTOCOL_VERSION,
    SIDECAR_OBSERVED_HOSTILES_PROTOCOL_VERSION,
} from "../../viewer/server/sidecar-ingest.mjs";

describe("viewer sidecar ingest", () => {
    it("accepts battle.events and appends them through the existing event-store path", async () => {
        const appendBattleEvents = vi.fn(async (events) => ({
            backend: "sqlite",
            received: events.length,
            stored: events.length,
            duplicates: 0,
        }));
        const majelIngest = vi.fn();
        const event = sampleBattleEvent();

        const result = await ingestSidecarEnvelope(sampleEnvelope({
            kind: "battle.events",
            payloadProtocol: SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
            payload: [event],
        }), {
            normalizeBattleEvents: (payload) => payload,
            appendBattleEvents,
            ingestFleetRuntimePayload: vi.fn(),
            developerMode: false,
            isDeveloperEvent: (candidate) => candidate?.type === "debug.event",
            developerModeRequiredPayload: () => ({ ok: false, error: "Developer mode required" }),
            majelIngest,
        });

        expect(result.statusCode).toBe(202);
        expect(result.body).toMatchObject({
            ok: true,
            protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
            kind: "battle.events",
            stored: 1,
            duplicates: 0,
        });
        expect(appendBattleEvents).toHaveBeenCalledWith([event], expect.objectContaining({
            kind: "battle.events",
            batchId: "batch-1",
        }));
        expect(majelIngest).not.toHaveBeenCalled();
    });

    it("accepts fleet.runtime and routes it through the raw broker adapter", async () => {
        const ingestFleetRuntimePayload = vi.fn(async (_payload, envelope) => ({
            received: 1,
            accepted: 1,
            rawStored: 1,
            projectionAdvanced: 1,
            duplicates: 0,
            outboxInserted: 1,
            outboxUpdated: 0,
            queueDepth: 1,
            sessionId: envelope.sessionId,
        }));
        const majelIngest = vi.fn();
        const runtimePayload = sampleFleetRuntimePayload();

        const result = await ingestSidecarEnvelope(sampleEnvelope({
            kind: "fleet.runtime",
            payloadProtocol: SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION,
            payload: runtimePayload,
        }), {
            appendBattleEvents: vi.fn(),
            ingestFleetRuntimePayload,
            majelIngest,
        });

        expect(result.statusCode).toBe(202);
        expect(result.body).toMatchObject({
            ok: true,
            protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
            kind: "fleet.runtime",
            accepted: 1,
            projectionAdvanced: 1,
            sessionId: "session-1",
        });
        expect(ingestFleetRuntimePayload).toHaveBeenCalledWith(runtimePayload, expect.objectContaining({
            kind: "fleet.runtime",
            batchId: "batch-1",
            sessionId: "session-1",
        }));
        expect(majelIngest).not.toHaveBeenCalled();
    });

    it("accepts observed.hostiles and appends them through the sidecar event store", async () => {
        const appendObservedHostileEvents = vi.fn(async (events) => ({
            backend: "sqlite",
            received: events.length,
            stored: events.length,
            duplicates: 0,
        }));
        const observedEvent = sampleObservedHostileEvent();

        const result = await ingestSidecarEnvelope(sampleEnvelope({
            kind: "observed.hostiles",
            payloadProtocol: SIDECAR_OBSERVED_HOSTILES_PROTOCOL_VERSION,
            payload: [observedEvent],
        }), {
            normalizeObservedHostileEvents: (payload) => payload,
            appendObservedHostileEvents,
            ingestFleetRuntimePayload: vi.fn(),
        });

        expect(result.statusCode).toBe(202);
        expect(result.body).toMatchObject({
            ok: true,
            protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
            kind: "observed.hostiles",
            stored: 1,
            duplicates: 0,
        });
        expect(appendObservedHostileEvents).toHaveBeenCalledWith([observedEvent], expect.objectContaining({
            kind: "observed.hostiles",
            batchId: "batch-1",
        }));
    });

    it("rejects unknown kinds", async () => {
        await expect(ingestSidecarEnvelope(sampleEnvelope({ kind: "diagnostics", payload: {} }), {}))
            .rejects.toThrow("Unsupported sidecar ingest kind");
    });

    it("rejects mismatched payload protocols", async () => {
        await expect(ingestSidecarEnvelope(sampleEnvelope({
            kind: "battle.events",
            payloadProtocol: SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION,
            payload: [sampleBattleEvent()],
        }), {})).rejects.toThrow(`battle.events requires payloadProtocol '${SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION}'.`);

        await expect(ingestSidecarEnvelope(sampleEnvelope({
            kind: "fleet.runtime",
            payloadProtocol: SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
            payload: sampleFleetRuntimePayload(),
        }), {})).rejects.toThrow(`fleet.runtime requires payloadProtocol '${SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION}'.`);

        await expect(ingestSidecarEnvelope(sampleEnvelope({
            kind: "observed.hostiles",
            payloadProtocol: SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION,
            payload: [sampleObservedHostileEvent()],
        }), {})).rejects.toThrow(`observed.hostiles requires payloadProtocol '${SIDECAR_OBSERVED_HOSTILES_PROTOCOL_VERSION}'.`);
    });

    it("rejects malformed envelopes and invalid payload shapes", async () => {
        await expect(ingestSidecarEnvelope({
            protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
            kind: "battle.events",
            producedAt: "2026-05-18T12:05:00.000Z",
            sessionId: "session-1",
            source: "stfc-community-mod",
            modVersion: "2.0.1-test",
            payloadProtocol: SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
            payload: [sampleBattleEvent()],
        }, {})).rejects.toThrow("Sidecar ingest field 'batchId' is required.");

        await expect(ingestSidecarEnvelope(sampleEnvelope({
            kind: "battle.events",
            payloadProtocol: SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
            payload: { type: "battle.event" },
        }), {})).rejects.toThrow("battle.events payload must be an array of sidecar events.");

        await expect(ingestSidecarEnvelope(sampleEnvelope({
            kind: "fleet.runtime",
            payloadProtocol: SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION,
            payload: [sampleFleetRuntimePayload()],
        }), {})).rejects.toThrow("fleet.runtime payload must be a fleet runtime snapshot object.");

        await expect(ingestSidecarEnvelope(sampleEnvelope({
            kind: "observed.hostiles",
            payloadProtocol: SIDECAR_OBSERVED_HOSTILES_PROTOCOL_VERSION,
            payload: { type: "observed.hostile" },
        }), {})).rejects.toThrow("observed.hostiles payload must be an array of sidecar events.");
    });
});

function sampleEnvelope(overrides = {}) {
    return {
        protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
        kind: "battle.events",
        batchId: "batch-1",
        producedAt: "2026-05-18T12:05:00.000Z",
        sessionId: "session-1",
        source: "stfc-community-mod",
        modVersion: "2.0.1-test",
        payloadProtocol: SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
        payload: [sampleBattleEvent()],
        ...overrides,
    };
}

function sampleBattleEvent() {
    return {
        protocolVersion: SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
        type: "battle.report",
        schemaVersion: "stfc.battle.summary.v1",
        sessionId: "session-1",
        timestamp: "2026-05-18T12:05:00.000Z",
        modVersion: "2.0.1-test",
        source: "stfc-community-mod",
        battleId: "battle-1",
        journalId: "journal-1",
        outcome: "win",
    };
}

function sampleFleetRuntimePayload() {
    return {
        type: "fleet.runtime",
        schemaVersion: SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION,
        source: "deployment-battle-end-event",
        observedAtMs: 1747569900000,
        fleetBarTracked: true,
        selectedIndex: 1,
        slots: [
            {
                slotIndex: 0,
                present: true,
                fleetId: 1003,
                currentStateName: "Warping",
                hullName: "Discovery",
                hullSpecId: 1307832955,
                shipIdentityProbe: { shipId: "2667207912673592502", source: "FleetPlayerData.Ship.ID" },
            },
            { slotIndex: 1, present: false },
        ],
    };
}

function sampleObservedHostileEvent() {
    return {
        protocolVersion: SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION,
        type: "observed.hostile",
        schemaVersion: "stfc.observed.hostile.v0",
        timestamp: "2026-05-18T12:05:03.000Z",
        source: "stfc-community-mod",
        observation: {
            sourceSurface: "prescan_target_widget",
            confidence: "strong",
            hullId: "3066099110",
            hullName: "Armada Carrier",
            runtimeFleetId: "4001",
            locationTranslationId: "847108551",
        },
    };
}
