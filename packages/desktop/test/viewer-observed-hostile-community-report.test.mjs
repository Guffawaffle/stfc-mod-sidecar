import { describe, expect, it } from "vitest";

import {
    OBSERVED_HOSTILE_COMMUNITY_REPORT_PROTOCOL_VERSION,
    buildObservedHostileCommunityReport,
    formatObservedHostileCommunityReportMarkdown,
} from "../../viewer/server/observed-hostile-community-report.mjs";

describe("viewer observed hostile community report", () => {
    it("splits high-confidence unmapped rows across submission-ready and review buckets", () => {
        const report = buildObservedHostileCommunityReport(buildObservedHostileSource(), {
            generatedAt: "2026-06-07T01:00:00.000Z",
            referenceCatalog: buildReferenceCatalogStub(),
        });

        expect(report.protocolVersion).toBe(OBSERVED_HOSTILE_COMMUNITY_REPORT_PROTOCOL_VERSION);
        expect(report.generatedAt).toBe("2026-06-07T01:00:00.000Z");
        expect(report.reference).toMatchObject({
            source: "stfc-space.hostiles",
            version: "2026-06-05",
            label: "stfc-space.hostiles 2026-06-05",
        });
        expect(report.summary).toEqual({
            highConfidenceUntrackedCount: 3,
            submissionReadyCount: 1,
            readyForMaintainerReviewCount: 1,
            needsIdentifierReviewCount: 1,
            excludedMatchedCount: 1,
            excludedAmbiguousCount: 1,
            excludedCandidateCount: 1,
            excludedInsufficientSignalCount: 1,
            excludedUnmappedLowEvidenceCount: 2,
        });

        const readyItem = report.items.find((item) => item.observedKey === "hull:missing-high");
        expect(readyItem).toMatchObject({
            observedKey: "hull:missing-high",
            identity: {
                kind: "hull_id",
                key: "hull:missing-high",
                quality: "coarse_shared",
                submissionReadiness: "submission_ready",
                missingFields: [],
            },
            ids: {
                hullId: "missing-high",
                userLocaId: "740001",
                locationTranslationId: null,
                userId: null,
                runtimeFleetIds: ["missing-high-runtime"],
                galaxyId: "226",
                instanceId: "instance-ready",
            },
            systemId: "189591311",
            level: 50,
            faction: "Klingon",
            hullType: "Explorer",
            hullName: "Hull_L50_Explorer_Klg_G5",
            grade: "G5",
            sourceSurfaces: ["fleet_data_system", "prescan_target_widget"],
            firstSeen: "2026-06-06T08:04:00.000Z",
            lastSeen: "2026-06-06T08:07:30.000Z",
            sightingCount: 2,
            observationCount: 1,
            baselineStatus: "unmapped",
            baselineCandidateCount: 0,
            evidenceConfidence: "high_confidence_passive_observation",
        });
        expect(readyItem.systems).toEqual([
            {
                systemId: "189591311",
                systemName: null,
                galaxyIds: ["226"],
                instanceIds: ["instance-ready"],
                firstSeen: "2026-06-06T08:04:00.000Z",
                lastSeen: "2026-06-06T08:07:30.000Z",
                sightingCount: 2,
                observationCount: 1,
                sourceSurfaces: ["fleet_data_system"],
            },
        ]);

        const maintainerReviewItem = report.items.find((item) => item.observedKey === "hull_name:hull_l5_survey_mar");
        expect(maintainerReviewItem).toMatchObject({
            observedKey: "hull_name:hull_l5_survey_mar",
            identity: {
                kind: "hull_name",
                key: "hull_name:hull_l5_survey_mar",
                quality: "coarse_label",
                submissionReadiness: "ready_for_maintainer_review",
                missingFields: ["hullId"],
            },
            ids: {
                hullId: null,
                userLocaId: "61309",
                locationTranslationId: null,
                userId: null,
                runtimeFleetIds: ["survey-mar-a", "survey-mar-b", "survey-mar-c"],
                galaxyId: "226",
                instanceId: "instance-maintainer-a",
            },
            systemId: null,
            level: 30,
            faction: null,
            hullType: "Survey",
            hullName: "Hull_L5_Survey_Mar",
            grade: "G2",
            sourceSurfaces: ["fleet_data_system"],
            firstSeen: "2026-06-06T08:08:00.000Z",
            lastSeen: "2026-06-06T08:11:00.000Z",
            sightingCount: 3,
            observationCount: 2,
            baselineStatus: "unmapped",
            baselineCandidateCount: 0,
            evidenceConfidence: "high_confidence_passive_observation",
            notes: [],
        });
        expect(maintainerReviewItem.systems).toEqual([
            {
                systemId: "267288673",
                systemName: null,
                galaxyIds: ["226"],
                instanceIds: ["instance-maintainer-b"],
                firstSeen: "2026-06-06T08:09:00.000Z",
                lastSeen: "2026-06-06T08:09:00.000Z",
                sightingCount: 1,
                observationCount: 1,
                sourceSurfaces: ["fleet_data_system"],
            },
            {
                systemId: "1946064743",
                systemName: null,
                galaxyIds: ["226"],
                instanceIds: ["instance-maintainer-a", "instance-maintainer-c"],
                firstSeen: "2026-06-06T08:08:00.000Z",
                lastSeen: "2026-06-06T08:11:00.000Z",
                sightingCount: 2,
                observationCount: 1,
                sourceSurfaces: ["fleet_data_system"],
            },
        ]);

        const reviewItem = report.items.find((item) => item.observedKey === "hull_name:hull_l60_explorer_wavedefense_klg_g6");
        expect(reviewItem).toMatchObject({
            observedKey: "hull_name:hull_l60_explorer_wavedefense_klg_g6",
            identity: {
                kind: "hull_name",
                key: "hull_name:hull_l60_explorer_wavedefense_klg_g6",
                quality: "coarse_label",
                submissionReadiness: "needs_identifier_review",
                missingFields: ["hullId", "userLocaId"],
            },
            ids: {
                hullId: null,
                userLocaId: null,
                locationTranslationId: null,
                userId: null,
                runtimeFleetIds: ["wave-defense-a", "wave-defense-b", "wave-defense-c"],
                galaxyId: "226",
                instanceId: "instance-review-a",
            },
            systemId: null,
            level: 60,
            faction: "Klingon",
            hullType: "Explorer",
            hullName: "Hull_L60_Explorer_WaveDefense_Klg_G6",
            grade: "G6",
            sourceSurfaces: ["fleet_data_system"],
            firstSeen: "2026-06-06T08:12:00.000Z",
            lastSeen: "2026-06-06T08:15:00.000Z",
            sightingCount: 3,
            observationCount: 2,
            baselineStatus: "unmapped",
            baselineCandidateCount: 0,
            evidenceConfidence: "high_confidence_passive_observation",
        });
        expect(reviewItem.systems).toEqual([
            {
                systemId: "267288673",
                systemName: null,
                galaxyIds: ["226"],
                instanceIds: ["instance-review-c"],
                firstSeen: "2026-06-06T08:13:00.000Z",
                lastSeen: "2026-06-06T08:13:00.000Z",
                sightingCount: 1,
                observationCount: 1,
                sourceSurfaces: ["fleet_data_system"],
            },
            {
                systemId: "1946064743",
                systemName: null,
                galaxyIds: ["226"],
                instanceIds: ["instance-review-a", "instance-review-b"],
                firstSeen: "2026-06-06T08:12:00.000Z",
                lastSeen: "2026-06-06T08:15:00.000Z",
                sightingCount: 2,
                observationCount: 1,
                sourceSurfaces: ["fleet_data_system"],
            },
        ]);
        expect(reviewItem.notes).toContain("Likely Wave Defense / inferred from hull name.");

        expect(report.items.map((item) => item.observedKey)).not.toContain("hull_name:hull_l39_destroyer_rom_assassin_g3");
        expect(report.items.map((item) => item.observedKey)).not.toContain("runtime:candidate-only");
        expect(report.items.map((item) => item.observedKey)).not.toContain("hull_name:hull_l40_battleship_fed_patrol_g3");
        expect(report.items.map((item) => item.observedKey)).not.toContain("user:signal_waiting");
    });

    it("renders markdown with separate submission-ready and review sections", () => {
        const report = buildObservedHostileCommunityReport(buildObservedHostileSource(), {
            generatedAt: "2026-06-07T01:00:00.000Z",
            referenceCatalog: buildReferenceCatalogStub(),
        });

        const markdown = formatObservedHostileCommunityReportMarkdown(report);

        expect(markdown).toContain("# Observed Hostile Community Report");
        expect(markdown).toContain("Reference: stfc-space.hostiles 2026-06-05");
        expect(markdown).toContain("## Summary");
        expect(markdown).toContain("* Submission-ready unmapped with hullId: 1");
        expect(markdown).toContain("* Ready for maintainer review without hullId: 1");
        expect(markdown).toContain("* Needs identifier review: 1");
        expect(markdown).toContain("userLocaId is included below only as a maintainer-review identifier.");
        expect(markdown).toContain("## Submission-ready unmapped hostiles");
        expect(markdown).toContain("## High-confidence unmapped hostiles ready for maintainer review");
        expect(markdown).toContain("## Unmapped observations needing identifier review");
        expect(markdown).toContain("### Hull_L50_Explorer_Klg_G5");
        expect(markdown).toContain("### Hull_L5_Survey_Mar");
        expect(markdown).toContain("### Hull_L60_Explorer_WaveDefense_Klg_G6");
        expect(markdown).toContain("Submission readiness: submission_ready");
        expect(markdown).toContain("Submission readiness: ready_for_maintainer_review");
        expect(markdown).toContain("Submission readiness: needs_identifier_review");
        expect(markdown).toContain("System 1946064743: 2 passive sightings across 1 observation window");
        expect(markdown).toContain("Maintainer-review identifiers: userLocaId=61309 (review aid only; not unique)");
        expect(markdown).toContain("Likely Wave Defense / inferred from hull name.");
        expect(markdown).not.toContain("candidate-only");
        expect(markdown).not.toContain("Hull_L40_Battleship_Fed_Patrol_G3");
        expect(markdown).not.toContain("runtimeFleetIds=");
        expect(markdown).not.toContain("galaxyIds=");
        expect(markdown).not.toContain("instanceIds=");
        expect(markdown).toContain("## Coverage");
        expect(markdown).toContain("* Submission-ready: 1");
        expect(markdown).toContain("* Needs identifier review: 1");
        expect(markdown).toContain("* Excluded candidate: 1");
        expect(markdown).toContain("* Excluded ambiguous: 1");
        expect(markdown).toContain("* Excluded unmapped below evidence gate: 2");
    });
});

function buildObservedHostileSource() {
    return {
        ok: true,
        source: "store",
        storageBackend: "sqlite",
        generatedAt: "2026-06-06T09:00:00.000Z",
        totalLines: 15,
        events: [
            observedLine(1, {
                timestamp: "2026-06-06T08:00:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L39_Destroyer_Rom_Assassin_G3",
                    hullTypeName: "Destroyer",
                    hullTypeValue: 0,
                    runtimeFleetId: "matched-row",
                    systemId: "818257505",
                    userLevel: 39,
                },
            }),
            observedLine(2, {
                timestamp: "2026-06-06T08:01:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    runtimeFleetId: "candidate-only",
                    systemId: "777777777",
                },
            }),
            observedLine(3, {
                timestamp: "2026-06-06T08:02:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L40_Battleship_Fed_Patrol_G3",
                    hullTypeName: "Battleship",
                    hullTypeValue: 1,
                    runtimeFleetId: "ambiguous-row",
                    systemId: "888888888",
                    userLevel: 40,
                },
            }),
            observedLine(4, {
                timestamp: "2026-06-06T08:03:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    userId: "signal_waiting",
                },
            }),
            observedLine(5, {
                timestamp: "2026-06-06T08:04:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullId: "missing-high",
                    hullName: "Hull_L50_Explorer_Klg_G5",
                    hullTypeName: "Explorer",
                    hullTypeValue: 2,
                    hullGrade: 5,
                    runtimeFleetId: "missing-high-runtime",
                    systemId: "189591311",
                    galaxyId: "226",
                    instanceId: "instance-ready",
                    userLevel: 50,
                    userLocaId: "740001",
                },
            }),
            observedLine(6, {
                timestamp: "2026-06-06T08:05:00.000Z",
                observation: {
                    sourceSurface: "prescan_target_widget",
                    confidence: "strong",
                    hullId: "missing-high",
                    hullName: "Hull_L50_Explorer_Klg_G5",
                    hullTypeName: "Explorer",
                    hullTypeValue: 2,
                    runtimeFleetId: "missing-high-runtime",
                    systemId: "189591311",
                    galaxyId: "226",
                    instanceId: "instance-ready",
                    userLevel: 50,
                    userLocaId: "740001",
                },
            }),
            observedLine(7, {
                timestamp: "2026-06-06T08:07:30.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullId: "missing-high",
                    hullName: "Hull_L50_Explorer_Klg_G5",
                    hullTypeName: "Explorer",
                    hullTypeValue: 2,
                    hullGrade: 5,
                    runtimeFleetId: "missing-high-runtime",
                    systemId: "189591311",
                    galaxyId: "226",
                    instanceId: "instance-ready",
                    userLevel: 50,
                    userLocaId: "740001",
                },
            }),
            observedLine(8, {
                timestamp: "2026-06-06T08:08:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L5_Survey_Mar",
                    hullTypeName: "Survey",
                    hullTypeValue: 1,
                    hullGrade: 2,
                    runtimeFleetId: "survey-mar-a",
                    systemId: "1946064743",
                    galaxyId: "226",
                    instanceId: "instance-maintainer-a",
                    userLevel: 30,
                    userLocaId: "61309",
                },
            }),
            observedLine(9, {
                timestamp: "2026-06-06T08:09:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L5_Survey_Mar",
                    hullTypeName: "Survey",
                    hullTypeValue: 1,
                    hullGrade: 2,
                    runtimeFleetId: "survey-mar-b",
                    systemId: "267288673",
                    galaxyId: "226",
                    instanceId: "instance-maintainer-b",
                    userLevel: 30,
                    userLocaId: "61309",
                },
            }),
            observedLine(10, {
                timestamp: "2026-06-06T08:11:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L5_Survey_Mar",
                    hullTypeName: "Survey",
                    hullTypeValue: 1,
                    hullGrade: 2,
                    runtimeFleetId: "survey-mar-c",
                    systemId: "1946064743",
                    galaxyId: "226",
                    instanceId: "instance-maintainer-c",
                    userLevel: 30,
                    userLocaId: "61309",
                },
            }),
            observedLine(11, {
                timestamp: "2026-06-06T08:12:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L60_Explorer_WaveDefense_Klg_G6",
                    hullTypeName: "Explorer",
                    hullTypeValue: 2,
                    hullGrade: 6,
                    runtimeFleetId: "wave-defense-a",
                    systemId: "1946064743",
                    galaxyId: "226",
                    instanceId: "instance-review-a",
                    userLevel: 60,
                },
            }),
            observedLine(12, {
                timestamp: "2026-06-06T08:13:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L60_Explorer_WaveDefense_Klg_G6",
                    hullTypeName: "Explorer",
                    hullTypeValue: 2,
                    hullGrade: 6,
                    runtimeFleetId: "wave-defense-b",
                    systemId: "267288673",
                    galaxyId: "226",
                    instanceId: "instance-review-c",
                    userLevel: 60,
                },
            }),
            observedLine(13, {
                timestamp: "2026-06-06T08:15:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L60_Explorer_WaveDefense_Klg_G6",
                    hullTypeName: "Explorer",
                    hullTypeValue: 2,
                    hullGrade: 6,
                    runtimeFleetId: "wave-defense-c",
                    systemId: "1946064743",
                    galaxyId: "226",
                    instanceId: "instance-review-b",
                    userLevel: 60,
                },
            }),
            observedLine(14, {
                timestamp: "2026-06-06T08:16:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    hullName: "Hull_L61_Explorer_Klg_G6",
                    hullTypeName: "Explorer",
                    hullTypeValue: 2,
                    runtimeFleetId: "missing-no-system",
                    userLevel: 61,
                },
            }),
            observedLine(15, {
                timestamp: "2026-06-06T08:17:00.000Z",
                observation: {
                    sourceSurface: "fleet_data_system",
                    confidence: "strong",
                    runtimeFleetId: "missing-no-hull-signal",
                    systemId: "190000000",
                    userLevel: 47,
                },
            }),
        ],
    };
}

function observedLine(lineNumber, overrides = {}) {
    const event = {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "observed.hostile",
        schemaVersion: "stfc.observed.hostile.v0",
        timestamp: "2026-06-06T08:00:00.000Z",
        source: "stfc-community-mod",
        observation: {
            sourceSurface: "fleet_data_system",
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

function buildReferenceCatalogStub() {
    const entries = [
        {
            hostileId: "320710612",
            name: "Romulan War Coalition",
            normalizedName: "romulan war coalition",
            factionName: "Romulan",
            normalizedFactionName: "romulan",
            level: 39,
            shipTypeValue: 13,
            hullTypeValue: 0,
            systemIds: ["818257505"],
            systemCount: 1,
            detailAvailable: true,
        },
        {
            hostileId: "770000001",
            name: "Candidate Baseline Row",
            normalizedName: "candidate baseline row",
            factionName: "Neutral",
            normalizedFactionName: "neutral",
            level: 12,
            shipTypeValue: 13,
            hullTypeValue: 0,
            systemIds: ["777777777"],
            systemCount: 1,
            detailAvailable: true,
        },
        {
            hostileId: "880000001",
            name: "Federation Border Patrol",
            normalizedName: "federation border patrol",
            factionName: "Federation",
            normalizedFactionName: "federation",
            level: 40,
            shipTypeValue: 13,
            hullTypeValue: 1,
            systemIds: ["888888888"],
            systemCount: 1,
            detailAvailable: true,
        },
        {
            hostileId: "880000002",
            name: "Federation Perimeter Patrol",
            normalizedName: "federation perimeter patrol",
            factionName: "Federation",
            normalizedFactionName: "federation",
            level: 40,
            shipTypeValue: 13,
            hullTypeValue: 1,
            systemIds: ["888888888"],
            systemCount: 1,
            detailAvailable: true,
        },
    ];
    const bySystemId = new Map();
    for (const entry of entries) {
        for (const systemId of entry.systemIds ?? []) {
            const items = bySystemId.get(systemId) ?? [];
            items.push(entry);
            bySystemId.set(systemId, items);
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
        bySystemId,
    };
}
