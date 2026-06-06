import { describe, expect, it } from "vitest";

import { buildObservedHostileCatalogSnapshot } from "../../viewer/server/observed-hostile-access.mjs";

describe("viewer observed hostile access", () => {
    it("aggregates observed hostile events into stable catalog entries", () => {
        const snapshot = buildObservedHostileCatalogSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 3,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T08:00:00.000Z",
                    observation: {
                        sourceSurface: "prescan_target_widget",
                        confidence: "strong",
                        hullId: "3066099110",
                        hullName: "Armada Carrier",
                        runtimeFleetId: "4001",
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T08:01:00.000Z",
                    observation: {
                        sourceSurface: "navigation_interaction",
                        confidence: "candidate-high",
                        hullId: "3066099110",
                        hullName: "Armada Carrier",
                        locationTranslationId: "847108551",
                    },
                }),
                observedLine(3, {
                    timestamp: "2026-06-06T08:02:00.000Z",
                    observation: {
                        sourceSurface: "navigation_interaction",
                        confidence: "candidate",
                        runtimeFleetId: "5002",
                        userId: "mar_special",
                    },
                }),
            ],
        }, { limit: 10 });

        expect(snapshot.ok).toBe(true);
        expect(snapshot.totalEntries).toBe(2);
        expect(snapshot.probeStatus).toBeNull();
        expect(snapshot.entries[0]).toMatchObject({
            key: "user:mar_special",
            identityKind: "user_id",
            identityQuality: "candidate_game_identity",
            sightingCount: 1,
        });
        expect(snapshot.entries[1]).toMatchObject({
            key: "hull:3066099110",
            identityKind: "hull_id",
            identityQuality: "coarse_shared",
            sightingCount: 2,
            strongestConfidence: "strong",
            sourceSurfaces: ["prescan_target_widget", "navigation_interaction"],
            hullIds: ["3066099110"],
            hullNames: ["Armada Carrier"],
        });
    });

    it("carries probe status metadata into the catalog payload", () => {
        const snapshot = buildObservedHostileCatalogSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 0,
            events: [],
        }, {
            limit: 10,
            probeStatus: {
                status: "restart_required",
                summary: "Restart STFC to load the hostile observation probe.",
            },
        });

        expect(snapshot.probeStatus).toMatchObject({
            status: "restart_required",
            summary: "Restart STFC to load the hostile observation probe.",
        });
    });
});

function observedLine(lineNumber, overrides = {}) {
    const event = {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "observed.hostile",
        schemaVersion: "stfc.observed.hostile.v0",
        timestamp: "2026-06-06T08:00:00.000Z",
        source: "stfc-community-mod",
        observation: {
            sourceSurface: "prescan_target_widget",
            confidence: "strong",
        },
        ...overrides,
    };

    return {
        lineNumber,
        parsed: true,
        eventType: event.type,
        timestamp: event.timestamp,
        event,
    };
}
