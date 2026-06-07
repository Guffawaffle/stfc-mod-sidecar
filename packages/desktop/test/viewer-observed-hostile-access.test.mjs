import { describe, expect, it } from "vitest";

import {
    buildObservedHostileCatalogEntriesSnapshot,
    buildObservedHostileCatalogSnapshot,
    buildObservedHostileObservationSnapshot,
} from "../../viewer/server/observed-hostile-access.mjs";

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
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullId: "3066099110",
                        hullName: "Armada Carrier",
                        runtimeFleetId: "4002",
                        systemId: "818257505",
                        userLevel: 39,
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
        expect(snapshot.totalEntries).toBe(1);
        expect(snapshot.passiveScannedEvents).toBe(1);
        expect(snapshot.supplementalScannedEvents).toBe(1);
        expect(snapshot.ignoredEvents).toBe(1);
        expect(snapshot.probeStatus).toBeNull();
        expect(snapshot.referenceCatalog).toMatchObject({
            available: false,
            source: "bundled",
        });
        expect(snapshot.sourceSurfaceCatalog).toEqual(expect.arrayContaining([
            expect.objectContaining({
                surface: "fleet_data_system",
                tier: "tier1_passive_system_view",
                countBehavior: "passive",
            }),
            expect.objectContaining({
                surface: "prescan_target_widget",
                tier: "tier2_view_adjacent_ui",
                countBehavior: "supplemental",
            }),
            expect.objectContaining({
                surface: "navigation_interaction",
                tier: "tier3_interactive",
                countBehavior: "debug_only",
            }),
        ]));
        expect(snapshot.entries[0]).toMatchObject({
            key: "hull:3066099110",
            identityKind: "hull_id",
            identityQuality: "coarse_shared",
            sightingCount: 2,
            strongestConfidence: "strong",
            evidenceTier: "tier1_passive_system_view",
            passiveSightingCount: 1,
            supplementalSightingCount: 1,
            sourceSurfaces: ["prescan_target_widget", "fleet_data_system"],
            hullIds: ["3066099110"],
            hullNames: ["Armada Carrier"],
        });
    });

    it("ignores neutral navigation-only POI rows without hostile identity signal", () => {
        const source = {
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 2,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T20:27:06.000Z",
                    observation: {
                        sourceSurface: "navigation_interaction",
                        confidence: "candidate",
                        isMarauder: false,
                        threatLevel: 0,
                        validNavigationInput: true,
                        showSetCourseArm: true,
                        locationTranslationId: "1274073018",
                        poiPointer: "000001FA01BB9EB0",
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T20:27:10.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullId: "1091387977",
                        hullName: "Hull_L49_Survey_Mar",
                        runtimeFleetId: "-217761210",
                        systemId: "1274073018",
                        userLevel: 49,
                    },
                }),
            ],
        };
        const catalog = buildObservedHostileCatalogEntriesSnapshot(source, { limit: 10 });
        const observations = buildObservedHostileObservationSnapshot(source, { limit: 10 });

        expect(catalog.scannedEvents).toBe(1);
        expect(catalog.ignoredEvents).toBe(1);
        expect(catalog.totalApprox).toBe(1);
        expect(catalog.items.map((entry) => entry.key)).toEqual(["hull:1091387977"]);
        expect(observations.scannedEvents).toBe(1);
        expect(observations.ignoredEvents).toBe(1);
        expect(observations.totalApprox).toBe(1);
        expect(observations.items[0]).toMatchObject({
            rawEventCount: 1,
            sightingCount: 1,
            observedHostileCount: 1,
            entryKeys: ["hull:1091387977"],
            surfaces: ["fleet_data_system"],
        });
    });

    it("keeps navigation interaction rows out of catalog and passive observation counts", () => {
        const source = {
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 3,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T08:00:00.000Z",
                    observation: {
                        sourceSurface: "navigation_interaction",
                        confidence: "candidate",
                        isMarauder: false,
                        threatLevel: 0,
                        locationTranslationId: "neutral",
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T08:01:00.000Z",
                    observation: {
                        sourceSurface: "navigation_interaction",
                        confidence: "candidate",
                        isMarauder: false,
                        threatLevel: 8,
                        locationTranslationId: "positive-threat",
                    },
                }),
                observedLine(3, {
                    timestamp: "2026-06-06T08:02:00.000Z",
                    observation: {
                        sourceSurface: "navigation_interaction",
                        confidence: "candidate-high",
                        isMarauder: true,
                        threatLevel: 0,
                        locationTranslationId: "marauder",
                    },
                }),
            ],
        };
        const catalog = buildObservedHostileCatalogEntriesSnapshot(source, { limit: 10 });
        const observations = buildObservedHostileObservationSnapshot(source, { limit: 10 });

        expect(catalog.scannedEvents).toBe(0);
        expect(catalog.ignoredEvents).toBe(3);
        expect(catalog.totalApprox).toBe(0);
        expect(catalog.items).toEqual([]);
        expect(observations.scannedEvents).toBe(0);
        expect(observations.ignoredEvents).toBe(3);
        expect(observations.totalApprox).toBe(0);
        expect(observations.items).toEqual([]);
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

    it("groups hull-name-only observations together and annotates bundled baseline matches", () => {
        const snapshot = buildObservedHostileCatalogSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 2,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T19:25:08.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullName: "Hull_L39_Destroyer_Rom_Assassin_G3",
                        hullTypeName: "Destroyer",
                        hullTypeValue: 0,
                        fleetTypeName: "Marauder",
                        fleetTypeValue: 2,
                        runtimeFleetId: "-1350222926",
                        systemId: "818257505",
                        userLevel: 39,
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T19:25:09.000Z",
                    observation: {
                        sourceSurface: "prescan_target_widget",
                        confidence: "strong",
                        hullName: "Hull_L39_Destroyer_Rom_Assassin_G3",
                        hullTypeName: "Destroyer",
                        hullTypeValue: 0,
                        fleetTypeName: "Marauder",
                        fleetTypeValue: 2,
                        runtimeFleetId: "2072328716",
                        systemId: "818257505",
                        userLevel: 39,
                    },
                }),
            ],
        }, {
            limit: 10,
            referenceCatalog: buildReferenceCatalogStub(),
        });

        expect(snapshot.referenceCatalog).toMatchObject({
            available: true,
            packId: "stfc-space.hostiles",
            version: "2026-06-05",
        });
        expect(snapshot.entries).toHaveLength(1);
        expect(snapshot.entries[0]).toMatchObject({
            key: "hull_name:hull_l39_destroyer_rom_assassin_g3",
            identityKind: "hull_name",
            identityQuality: "coarse_label",
            sightingCount: 2,
            systemIds: ["818257505"],
            userLevels: [39],
            hullTypeValues: [0],
            fleetTypeNames: ["Marauder"],
        });
        expect(snapshot.entries[0].baseline).toMatchObject({
            available: true,
            status: "matched",
            candidateCount: 1,
        });
        expect(snapshot.entries[0].referencePresence).toBe("known");
        expect(snapshot.entries[0].baseline.matches[0]).toMatchObject({
            hostileId: "320710612",
            name: "Romulan War Coalition",
            level: 39,
            matchSignals: ["system", "level", "hull_type", "faction"],
        });
    });

    it("projects system observations from time-windowed sightings with match health", () => {
        const snapshot = buildObservedHostileObservationSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 3,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T19:25:08.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullName: "Hull_L39_Destroyer_Rom_Assassin_G3",
                        hullTypeName: "Destroyer",
                        hullTypeValue: 0,
                        systemId: "818257505",
                        userLevel: 39,
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T19:25:20.000Z",
                    observation: {
                        sourceSurface: "prescan_target_widget",
                        confidence: "strong",
                        hullName: "Hull_L40_Battleship_Fed_Patrol_G3",
                        hullTypeName: "Battleship",
                        hullTypeValue: 1,
                        systemId: "818257505",
                        userLevel: 40,
                    },
                }),
                observedLine(3, {
                    timestamp: "2026-06-06T19:27:30.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullName: "Hull_L41_Destroyer_Rom_Patrol_G3",
                        hullTypeName: "Destroyer",
                        hullTypeValue: 0,
                        systemId: "818257505",
                        userLevel: 41,
                    },
                }),
            ],
        }, {
            limit: 10,
            windowMs: 60000,
            referenceCatalog: buildReferenceCatalogStub({ includeAmbiguousFederation: true }),
        });

        expect(snapshot.detail).toBe("observed-hostile-observations");
        expect(snapshot.totalApprox).toBe(2);
        const mixedWindow = snapshot.items.find((item) => item.systemId === "818257505" && item.supplementalSightingCount === 1);
        expect(mixedWindow).toMatchObject({
            systemId: "818257505",
            surfaces: ["fleet_data_system", "prescan_target_widget"],
            rawEventCount: 1,
            sightingCount: 1,
            supplementalRawEventCount: 1,
            supplementalSightingCount: 1,
            observedHostileCount: 1,
            supplementalObservedHostileCount: 1,
            totalObservedHostileCount: 2,
            referencePresence: {
                known: 1,
                unknown: 0,
                needsSignal: 0,
                unavailable: 0,
            },
            matchHealth: {
                matched: 1,
                ambiguous: 0,
                unmapped: 0,
                insufficientSignal: 0,
            },
        });
        expect(mixedWindow.entries.map((entry) => entry.matchHealthStatus)).toEqual(["matched"]);
        expect(mixedWindow.supplementalEntries.map((entry) => entry.matchHealthStatus)).toEqual(["ambiguous"]);
    });

    it("does not create passive observation windows from supplemental-only prescan sightings", () => {
        const snapshot = buildObservedHostileObservationSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 2,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T19:25:08.000Z",
                    observation: {
                        sourceSurface: "prescan_target_widget",
                        confidence: "strong",
                        hullName: "Hull_L39_Destroyer_Rom_Assassin_G3",
                        runtimeFleetId: "prescan-only-1",
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T19:25:20.000Z",
                    observation: {
                        sourceSurface: "prescan_target_widget",
                        confidence: "strong",
                        hullName: "Hull_L40_Battleship_Fed_Patrol_G3",
                        runtimeFleetId: "prescan-only-2",
                    },
                }),
            ],
        }, {
            limit: 10,
            windowMs: 60000,
            referenceCatalog: buildReferenceCatalogStub({ includeAmbiguousFederation: true }),
        });

        expect(snapshot.scannedEvents).toBe(2);
        expect(snapshot.passiveScannedEvents).toBe(0);
        expect(snapshot.supplementalScannedEvents).toBe(2);
        expect(snapshot.totalApprox).toBe(0);
        expect(snapshot.items).toEqual([]);
    });

    it("keeps sparse same-system passive sightings in one observation window by default", () => {
        const snapshot = buildObservedHostileObservationSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 4,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T22:44:48.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullId: "1809917740",
                        hullName: "Hull_L51_Explorer_Klg_G5",
                        hullTypeName: "Explorer",
                        hullTypeValue: 2,
                        systemId: "189591311",
                        userLevel: 51,
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T22:46:50.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullId: "1231557728",
                        hullName: "Hull_L50_Explorer_Klg_G5",
                        hullTypeName: "Explorer",
                        hullTypeValue: 2,
                        systemId: "189591311",
                        userLevel: 50,
                    },
                }),
                observedLine(3, {
                    timestamp: "2026-06-06T22:48:53.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullId: "1692955230",
                        hullName: "Hull_L51_Survey_Klg_G5",
                        hullTypeName: "Survey",
                        hullTypeValue: 1,
                        systemId: "189591311",
                        userLevel: 51,
                    },
                }),
                observedLine(4, {
                    timestamp: "2026-06-06T22:50:54.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullId: "1037118594",
                        hullName: "Hull_L50_Survey_Klg_G5",
                        hullTypeName: "Survey",
                        hullTypeValue: 1,
                        systemId: "189591311",
                        userLevel: 50,
                    },
                }),
            ],
        }, {
            limit: 10,
            referenceCatalog: buildReferenceCatalogStub({
                extraEntries: [
                    {
                        hostileId: "510000001",
                        name: "KSG Border Patrol",
                        normalizedName: "ksg border patrol",
                        factionName: "Klingon",
                        normalizedFactionName: "klingon",
                        level: 51,
                        shipTypeValue: 7,
                        hullTypeValue: 2,
                        systemIds: ["189591311"],
                        systemCount: 1,
                        detailAvailable: true,
                    },
                    {
                        hostileId: "500000001",
                        name: "KSG Procurement",
                        normalizedName: "ksg procurement",
                        factionName: "Klingon",
                        normalizedFactionName: "klingon",
                        level: 50,
                        shipTypeValue: 10,
                        hullTypeValue: 1,
                        systemIds: ["189591311"],
                        systemCount: 1,
                        detailAvailable: true,
                    },
                ],
            }),
        });

        expect(snapshot.observationWindowMs).toBe(300000);
        expect(snapshot.totalApprox).toBe(1);
        expect(snapshot.items[0]).toMatchObject({
            systemId: "189591311",
            observedHostileCount: 4,
            rawEventCount: 4,
            sightingCount: 4,
            referencePresence: {
                known: 4,
                unknown: 0,
                needsSignal: 0,
                unavailable: 0,
            },
        });
        expect(snapshot.items[0].entries.map((entry) => entry.title)).toEqual([
            "Hull_L50_Survey_Klg_G5",
            "Hull_L51_Survey_Klg_G5",
            "Hull_L50_Explorer_Klg_G5",
            "Hull_L51_Explorer_Klg_G5",
        ]);
    });

    it("filters catalog entries and observations by bundled reference presence", () => {
        const source = {
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 3,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T08:00:00.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullName: "Hull_L39_Destroyer_Rom_Assassin_G3",
                        hullTypeValue: 0,
                        systemId: "818257505",
                        userLevel: 39,
                    },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T08:02:00.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        hullName: "Hull_L47_Battleship_Kli_Unknown_G4",
                        hullTypeValue: 1,
                        systemId: "999999999",
                        userLevel: 47,
                    },
                }),
                observedLine(3, {
                    timestamp: "2026-06-06T08:04:00.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        userId: "signal_waiting",
                    },
                }),
            ],
        };

        const catalogKnown = buildObservedHostileCatalogEntriesSnapshot(source, {
            limit: 10,
            reference: "known",
            referenceCatalog: buildReferenceCatalogStub(),
        });
        const catalogUnknown = buildObservedHostileCatalogEntriesSnapshot(source, {
            limit: 10,
            reference: "unknown",
            referenceCatalog: buildReferenceCatalogStub(),
        });
        const catalogNeedsSignal = buildObservedHostileCatalogEntriesSnapshot(source, {
            limit: 10,
            reference: "needs_signal",
            referenceCatalog: buildReferenceCatalogStub(),
        });
        const observationUnknown = buildObservedHostileObservationSnapshot(source, {
            limit: 10,
            windowMs: 60000,
            reference: "unknown",
            referenceCatalog: buildReferenceCatalogStub(),
        });

        expect(catalogKnown.items.map((entry) => entry.referencePresence)).toEqual(["known"]);
        expect(catalogUnknown.items.map((entry) => entry.referencePresence)).toEqual(["unknown"]);
        expect(catalogNeedsSignal.items.map((entry) => entry.referencePresence)).toEqual(["needs_signal"]);
        expect(observationUnknown.items).toHaveLength(1);
        expect(observationUnknown.items[0].referencePresence).toEqual({
            known: 0,
            unknown: 1,
            needsSignal: 0,
            unavailable: 0,
        });
    });

    it("keeps baseline candidate matches distinct from insufficient-signal filters", () => {
        const source = {
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 1,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T08:00:00.000Z",
                    observation: {
                        sourceSurface: "fleet_data_system",
                        confidence: "strong",
                        runtimeFleetId: "candidate-1",
                        systemId: "818257505",
                    },
                }),
            ],
        };

        const catalogCandidate = buildObservedHostileCatalogEntriesSnapshot(source, {
            limit: 10,
            status: "candidate",
            referenceCatalog: buildReferenceCatalogStub(),
        });
        const catalogInsufficient = buildObservedHostileCatalogEntriesSnapshot(source, {
            limit: 10,
            status: "insufficient_signal",
            referenceCatalog: buildReferenceCatalogStub(),
        });
        const observationCandidate = buildObservedHostileObservationSnapshot(source, {
            limit: 10,
            windowMs: 60000,
            status: "candidate",
            referenceCatalog: buildReferenceCatalogStub(),
        });

        expect(catalogCandidate.items).toHaveLength(1);
        expect(catalogCandidate.items[0]).toMatchObject({
            matchHealthStatus: "candidate",
            referencePresence: "known",
            baseline: {
                available: true,
                status: "candidate",
            },
        });
        expect(catalogInsufficient.items).toEqual([]);
        expect(observationCandidate.items).toHaveLength(1);
        expect(observationCandidate.items[0].matchHealth).toEqual({
            matched: 0,
            candidate: 1,
            ambiguous: 0,
            unmapped: 0,
            insufficientSignal: 0,
        });
    });

    it("paginates catalog entries after server-side projection filters", () => {
        const source = {
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            totalLines: 3,
            events: [
                observedLine(1, {
                    timestamp: "2026-06-06T08:00:00.000Z",
                    observation: { sourceSurface: "fleet_data_system", confidence: "strong", userId: "mar_one" },
                }),
                observedLine(2, {
                    timestamp: "2026-06-06T08:01:00.000Z",
                    observation: { sourceSurface: "fleet_data_system", confidence: "strong", userId: "mar_two" },
                }),
                observedLine(3, {
                    timestamp: "2026-06-06T08:02:00.000Z",
                    observation: { sourceSurface: "fleet_data_system", confidence: "strong", userId: "mar_three" },
                }),
            ],
        };
        const firstPage = buildObservedHostileCatalogEntriesSnapshot(source, {
            limit: 2,
            status: "insufficient_signal",
        });
        const secondPage = buildObservedHostileCatalogEntriesSnapshot(source, {
            limit: 2,
            status: "insufficient_signal",
            cursor: firstPage.nextCursor,
        });

        expect(firstPage.detail).toBe("observed-hostile-catalog-entries");
        expect(firstPage.totalApprox).toBe(3);
        expect(firstPage.items.map((entry) => entry.key)).toEqual(["user:mar_three", "user:mar_two"]);
        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.nextCursor).toEqual(expect.any(String));
        expect(secondPage.items.map((entry) => entry.key)).toEqual(["user:mar_one"]);
        expect(secondPage.hasMore).toBe(false);
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

function buildReferenceCatalogStub(options = {}) {
    const entry = {
        hostileId: "320710612",
        name: "Romulan War Coalition",
        normalizedName: "romulan war coalition",
        factionName: "Romulan",
        normalizedFactionName: "romulan",
        level: 39,
        shipTypeValue: 13,
        hullTypeValue: 0,
        rarity: 1,
        strength: 6664142,
        warp: 31,
        systemIds: ["818257505"],
        systemCount: 1,
        xpAmount: 2001,
        detailAvailable: true,
    };
    const entries = [entry];
    if (options.includeAmbiguousFederation) {
        entries.push(
            {
                hostileId: "420000001",
                name: "Federation Border Patrol",
                normalizedName: "federation border patrol",
                factionName: "Federation",
                normalizedFactionName: "federation",
                level: 40,
                shipTypeValue: 13,
                hullTypeValue: 1,
                systemIds: ["818257505"],
                systemCount: 1,
                detailAvailable: true,
            },
            {
                hostileId: "420000002",
                name: "Federation Perimeter Patrol",
                normalizedName: "federation perimeter patrol",
                factionName: "Federation",
                normalizedFactionName: "federation",
                level: 40,
                shipTypeValue: 13,
                hullTypeValue: 1,
                systemIds: ["818257505"],
                systemCount: 1,
                detailAvailable: true,
            },
        );
    }
    if (Array.isArray(options.extraEntries)) {
        entries.push(...options.extraEntries);
    }
    const bySystem = new Map();
    for (const candidate of entries) {
        for (const systemId of candidate.systemIds ?? []) {
            const items = bySystem.get(systemId) ?? [];
            items.push(candidate);
            bySystem.set(systemId, items);
        }
    }

    return {
        available: true,
        pack: {
            packId: "stfc-space.hostiles",
            version: "2026-06-05",
            entryCount: entries.length,
        },
        entries,
        bySystemId: bySystem,
    };
}
