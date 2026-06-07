import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
    buildObservedHostileCoveragePayload,
    buildObservedHostileInspectionPayload,
    buildObservedHostileMaintainerQuestionsMarkdown,
    buildObservedHostileReportPayload,
    buildObservedHostileReviewPacketArtifactPlan,
    buildObservedHostileReviewSummaryMarkdown,
    parseObservedHostileAxArgs,
    summarizeObservedHostileReportForAx,
} from "../../../scripts/observed-hostile-ax.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const axScript = readFileSync(path.resolve(__dirname, "../../../scripts/ax.mjs"), "utf8");
const familyManifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../manifests/families/sidecar.family.json"), "utf8"));

describe("observed hostile ax tools", () => {
    it("parses inspect and report arguments", () => {
        expect(parseObservedHostileAxArgs([
            "--key",
            "hull:missing-high",
            "--status",
            "unmapped",
            "--limit",
            "10",
            "--raw-limit",
            "7",
        ], { mode: "inspect" })).toEqual({
            key: "hull:missing-high",
            q: "",
            status: "unmapped",
            reference: "",
            systemId: "",
            limit: 10,
            rawLimit: 7,
            markdown: false,
        });

        expect(parseObservedHostileAxArgs([
            "--source",
            "live",
            "--server-url",
            "http://127.0.0.1:43127",
            "--markdown",
            "--json-out",
            ".artifacts/report.json",
            "--markdown-out",
            ".artifacts/report.md",
            "--preview-limit",
            "7",
            "--full",
            "--timeout-sec",
            "9",
        ], { mode: "report" })).toEqual({
            markdown: true,
            source: "live",
            serverUrl: "http://127.0.0.1:43127",
            jsonOut: ".artifacts/report.json",
            markdownOut: ".artifacts/report.md",
            previewLimit: 7,
            full: true,
            timeoutSec: 9,
        });

        expect(parseObservedHostileAxArgs([
            "--source",
            "live",
            "--report-json",
            ".artifacts/community-report.json",
            "--json-out",
            ".artifacts/coverage.json",
            "--preview-limit",
            "4",
        ], { mode: "coverage" })).toEqual({
            source: "live",
            serverUrl: "",
            reportJson: ".artifacts/community-report.json",
            jsonOut: ".artifacts/coverage.json",
            previewLimit: 4,
            timeoutSec: 4,
        });

        expect(parseObservedHostileAxArgs([
            "--source",
            "live",
            "--output-dir",
            ".artifacts/coverage-investigation",
            "--base-name",
            "community-report-sudo-review",
            "--preview-limit",
            "3",
            "--timeout-sec",
            "12",
        ], { mode: "review-packet" })).toEqual({
            source: "live",
            serverUrl: "",
            outputDir: ".artifacts/coverage-investigation",
            baseName: "community-report-sudo-review",
            previewLimit: 3,
            timeoutSec: 12,
        });
    });

    it("builds a direct inspection payload with raw evidence and report inclusion", () => {
        const payload = buildObservedHostileInspectionPayload(buildObservedHostileSource(), {
            key: "hull:missing-high",
            limit: 10,
            rawLimit: 10,
            generatedAt: "2026-06-07T03:00:00.000Z",
            referenceCatalog: buildReferenceCatalogStub(),
        });

        expect(payload).toMatchObject({
            ok: true,
            protocolVersion: "stfc.observed-hostile.ax.v1",
            detail: "observed-hostile-inspection",
            generatedAt: "2026-06-07T03:00:00.000Z",
            filters: {
                key: "hull:missing-high",
                limit: 10,
                rawLimit: 10,
            },
            catalog: {
                returnedEntries: 1,
            },
        });

        expect(payload.items[0]).toMatchObject({
            key: "hull:missing-high",
            matchHealthStatus: "unmapped",
            referencePresence: "unknown",
            highConfidenceGate: {
                include: true,
                systemId: "189591311",
                level: 50,
            },
            includedInCommunityReport: true,
            communityReportItem: {
                observedKey: "hull:missing-high",
                identity: {
                    submissionReadiness: "submission_ready",
                },
            },
            rawEvidence: {
                totalMatchingEvents: 3,
                passiveEventCount: 2,
                supplementalEventCount: 1,
                firstSeen: "2026-06-06T08:04:00.000Z",
                lastSeen: "2026-06-06T08:07:30.000Z",
                systems: ["189591311"],
            },
        });
        expect(payload.items[0].rawEvidence.events).toEqual([
            expect.objectContaining({
                lineNumber: 7,
                sourceSurface: "fleet_data_system",
                countBehavior: "passive",
                hullId: "missing-high",
                userLocaId: "740001",
            }),
            expect.objectContaining({
                lineNumber: 6,
                sourceSurface: "prescan_target_widget",
                countBehavior: "supplemental",
                hullId: "missing-high",
            }),
            expect.objectContaining({
                lineNumber: 5,
                sourceSurface: "fleet_data_system",
                countBehavior: "passive",
                hullId: "missing-high",
            }),
        ]);
    });

    it("keeps candidate rows inspectable without treating them as missing hostiles", () => {
        const payload = buildObservedHostileInspectionPayload(buildObservedHostileSource(), {
            key: "runtime:candidate-only",
            limit: 10,
            rawLimit: 5,
            generatedAt: "2026-06-07T03:00:00.000Z",
            referenceCatalog: buildReferenceCatalogStub(),
        });

        expect(payload.items).toHaveLength(1);
        expect(payload.items[0]).toMatchObject({
            key: "runtime:candidate-only",
            matchHealthStatus: "candidate",
            referencePresence: "known",
            highConfidenceGate: {
                include: false,
                reasons: expect.arrayContaining(["baseline_status_not_unmapped"]),
            },
            includedInCommunityReport: false,
            communityReportItem: null,
            rawEvidence: {
                totalMatchingEvents: 1,
                passiveEventCount: 1,
            },
        });
    });

    it("builds the report payload with optional markdown and exposed ax commands", () => {
        const payload = buildObservedHostileReportPayload(buildObservedHostileSource(), {
            generatedAt: "2026-06-07T03:00:00.000Z",
            includeMarkdown: true,
            referenceCatalog: buildReferenceCatalogStub(),
        });

        expect(payload).toMatchObject({
            ok: true,
            protocolVersion: "stfc.observed-hostile.ax.v1",
            detail: "observed-hostile-report",
            report: {
                protocolVersion: "stfc.observed-hostile.community-report.v1",
                summary: {
                    submissionReadyCount: 1,
                    readyForMaintainerReviewCount: 1,
                    needsIdentifierReviewCount: 1,
                },
            },
        });
        expect(payload.markdown).toContain("## Submission-ready unmapped hostiles");
        expect(payload.markdown).toContain("### Hull_L50_Explorer_Klg_G5");
        expect(payload.markdown).not.toContain("candidate-only");

        const summary = summarizeObservedHostileReportForAx(payload, {
            previewLimit: 2,
            markdown: true,
            jsonOut: ".artifacts/report.json",
            markdownOut: ".artifacts/report.md",
        });
        expect(summary).toMatchObject({
            ok: true,
            protocolVersion: "stfc.observed-hostile.ax.v1",
            detail: "observed-hostile-report",
            summary: {
                submissionReadyCount: 1,
                readyForMaintainerReviewCount: 1,
                needsIdentifierReviewCount: 1,
            },
            previewCount: 2,
            previewTotal: 3,
            itemsPreview: [
                {
                    observedKey: "hull:missing-high",
                    submissionReadiness: "submission_ready",
                },
                {
                    observedKey: "hull_name:hull_l5_survey_mar",
                    submissionReadiness: "ready_for_maintainer_review",
                },
            ],
            artifacts: {
                jsonOut: expect.stringContaining(".artifacts"),
                markdownOut: expect.stringContaining(".artifacts"),
            },
        });

        expect(axScript).toContain("observed-hostiles:report");
        expect(axScript).toContain("observed-hostiles:coverage");
        expect(axScript).toContain("observed-hostiles:inspect");
        expect(axScript).toContain("observed-hostiles:review-packet");
        expect(familyManifest.commands["observed-hostile-report"].executionTarget.args).toEqual(["observed-hostiles:report"]);
        expect(familyManifest.commands["observed-hostile-inspect"].executionTarget.args).toEqual(["observed-hostiles:inspect"]);
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties.markdown.type).toBe("boolean");
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties["source"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties["server-url"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties["json-out"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties["markdown-out"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties["preview-limit"].type).toBe("integer");
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties["full"].type).toBe("boolean");
        expect(familyManifest.commands["observed-hostile-report"].argsSchema.properties["timeout-sec"].type).toBe("integer");
        expect(familyManifest.commands["observed-hostile-coverage"].executionTarget.args).toEqual(["observed-hostiles:coverage"]);
        expect(familyManifest.commands["observed-hostile-coverage"].argsSchema.properties["report-json"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-review-packet"].executionTarget.args).toEqual(["observed-hostiles:review-packet"]);
        expect(familyManifest.commands["observed-hostile-review-packet"].argsSchema.properties["output-dir"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-review-packet"].argsSchema.properties["base-name"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-inspect"].argsSchema.properties["system-id"].type).toBe("string");
        expect(familyManifest.commands["observed-hostile-inspect"].argsSchema.properties["raw-limit"].type).toBe("integer");
    });

    it("builds coverage analysis and maintainer packet helpers from a report", () => {
        const reportPayload = buildObservedHostileReportPayload(buildObservedHostileSource(), {
            generatedAt: "2026-06-07T03:00:00.000Z",
            includeMarkdown: true,
            referenceCatalog: buildReferenceCatalogStub(),
        });

        const coverage = buildObservedHostileCoveragePayload(reportPayload, {
            previewLimit: 2,
        });
        expect(coverage).toMatchObject({
            ok: true,
            detail: "observed-hostile-coverage",
            summary: {
                submissionReadyCount: 1,
                readyForMaintainerReviewCount: 1,
                needsIdentifierReviewCount: 1,
            },
            coverage: {
                totalItems: 3,
                readiness: {
                    submissionReady: 1,
                    readyForMaintainerReview: 1,
                    needsIdentifierReview: 1,
                },
                hullId: {
                    present: 1,
                    missing: 2,
                },
                userLocaId: {
                    present: 2,
                    missing: 1,
                },
                waveDefense: {
                    likely: 1,
                    notLikely: 2,
                },
            },
        });
        expect(coverage.representativeRows.nonWave).toMatchObject({
            observedKey: "hull:missing-high",
        });
        expect(coverage.hullIdMissingPreview).toHaveLength(2);

        const summaryMarkdown = buildObservedHostileReviewSummaryMarkdown(reportPayload.report);
        expect(summaryMarkdown).toContain("* Submission-ready with hullId: 1");
        expect(summaryMarkdown).toContain("* Ready for maintainer review without hullId: 1");
        expect(summaryMarkdown).toContain("`Hull_L5_Survey_Mar`");
        expect(summaryMarkdown).toContain("Nothing is auto-submitted.");

        const questionsMarkdown = buildObservedHostileMaintainerQuestionsMarkdown();
        expect(questionsMarkdown).toContain("Is `hullId` the identifier you want for missing-hostile reports?");

        const artifactPlan = buildObservedHostileReviewPacketArtifactPlan({
            outputDir: ".artifacts/coverage-investigation",
            baseName: "community-report-sudo-review",
        });
        expect(artifactPlan).toMatchObject({
            reportJsonOut: expect.stringContaining("community-report-sudo-review.json"),
            reportMarkdownOut: expect.stringContaining("community-report-sudo-review.md"),
            summaryOut: expect.stringContaining("community-report-sudo-review-summary.md"),
            questionsOut: expect.stringContaining("community-report-sudo-review-questions.md"),
        });
    });
});

function buildObservedHostileSource() {
    return {
        ok: true,
        source: "store",
        storageBackend: "sqlite",
        generatedAt: "2026-06-06T09:00:00.000Z",
        totalLines: 15,
        returnedLines: 15,
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
