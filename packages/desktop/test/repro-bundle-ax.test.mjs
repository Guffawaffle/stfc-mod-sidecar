import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
    buildReproBundleLexFrame,
    parseReproBundleAxArgs,
    resolveNpxInvocation,
    resolveReproBundleArtifactPlan,
    summarizeReproBundlePayload,
} from "../../../scripts/repro-bundle-ax.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const axScript = readFileSync(path.resolve(__dirname, "../../../scripts/ax.mjs"), "utf8");
const familyManifest = JSON.parse(readFileSync(path.resolve(__dirname, "../../../manifests/families/sidecar.family.json"), "utf8"));

describe("repro bundle ax", () => {
    test("parses bundle arguments for cross-repo capture", () => {
        expect(parseReproBundleAxArgs([
            "--mod-repo-root",
            "D:\\dev\\stfc-mod",
            "--server-url",
            "http://127.0.0.1:43127",
            "--label",
            "manual repro",
            "--debug-limit",
            "30",
            "--observed-limit",
            "12",
            "--native-recent-limit",
            "9",
            "--log-last",
            "120",
            "--report-preview",
            "7",
            "--timeout-sec",
            "6",
            "--skip-mark",
            "--lex-dry-run",
            "--summary-only",
            "--json-out",
            ".artifacts/repro-bundle.json",
            "--output-dir",
            ".artifacts/repro-bundle",
        ])).toEqual({
            modRepoRoot: "D:\\dev\\stfc-mod",
            serverUrl: "http://127.0.0.1:43127",
            label: "manual repro",
            debugLimit: 30,
            observedLimit: 12,
            nativeRecentLimit: 9,
            logLast: 120,
            reportPreview: 7,
            timeoutSec: 6,
            skipMark: true,
            skipLex: false,
            lexDryRun: true,
            summaryOnly: true,
            jsonOut: ".artifacts/repro-bundle.json",
            outputDir: ".artifacts/repro-bundle",
        });
    });

    test("builds a bounded lex frame from repro bundle summary", () => {
        const frame = buildReproBundleLexFrame({
            label: "ax repro bundle 2026-06-07",
            native: {
                mark: { ok: true },
            },
            sidecar: {
                debugEvents: { returnedLines: 18 },
                observedEvents: { returnedLines: 7 },
                observedHostileReport: {
                    summary: {
                        submissionReadyCount: 1,
                        readyForMaintainerReviewCount: 2,
                        needsIdentifierReviewCount: 3,
                    },
                },
            },
        });

        expect(frame).toEqual({
            referencePoint: "ax repro bundle 2026-06-07",
            summary: "repro bundle mark-ok; report 1/2/3; sidecar debug 18; observed 7",
            next: "Review bundle payload, recent sidecar events, and observed hostile report preview.",
            modules: "stfc-mod-sidecar,stfc-mod",
            keywords: "repro-bundle,observed-hostiles,sidecar,native-log",
            permissions: "local-files,localhost",
        });

        expect(axScript).toContain("repro:bundle");
        expect(familyManifest.commands["repro-bundle"].executionTarget.args).toEqual(["repro:bundle"]);
        expect(familyManifest.commands["repro-bundle"].argsSchema.properties["mod-repo-root"].type).toBe("string");
        expect(familyManifest.commands["repro-bundle"].argsSchema.properties["debug-limit"].type).toBe("integer");
        expect(familyManifest.commands["repro-bundle"].argsSchema.properties["skip-lex"].type).toBe("boolean");
        expect(familyManifest.commands["repro-bundle"].argsSchema.properties["summary-only"].type).toBe("boolean");
        expect(familyManifest.commands["repro-bundle"].argsSchema.properties["json-out"].type).toBe("string");
        expect(familyManifest.commands["repro-bundle"].argsSchema.properties["output-dir"].type).toBe("string");
    });

    test("resolves npx invocation for lex without depending on npm shell context", () => {
        const invocation = resolveNpxInvocation(["@smartergpt/lex", "--help"]);
        expect(invocation.command).toBeTruthy();
        expect(invocation.args).toEqual(expect.arrayContaining(["@smartergpt/lex", "--help"]));
        if (invocation.command === "npx.cmd") {
            expect(invocation.shell).toBe(true);
        } else {
            expect(invocation.command).toBe(process.execPath);
            expect(invocation.shell).toBe(false);
        }
    });

    test("builds output-dir artifact paths and summary-only payloads", () => {
        const artifactPlan = resolveReproBundleArtifactPlan({
            outputDir: ".artifacts/repro-bundle",
        });
        expect(artifactPlan.outputDir).toContain(".artifacts");
        expect(artifactPlan.bundleJsonOut).toContain("repro-bundle.json");
        expect(artifactPlan.observedHostileReportJsonOut).toContain("observed-hostile-community-report.json");
        expect(artifactPlan.observedHostileReportMarkdownOut).toContain("observed-hostile-community-report.md");

        const summary = summarizeReproBundlePayload({
            ok: true,
            generatedAt: "2026-06-07T06:00:00.000Z",
            label: "manual repro",
            modRepoRoot: "D:\\dev\\stfc-mod",
            sidecarRepoRoot: "D:\\dev\\stfc-mod-sidecar",
            serverUrl: "http://127.0.0.1:43127",
            desktop: {
                mode: "managed-healthy",
                managed: true,
                healthy: true,
                running: true,
                pid: 1234,
                port: 43127,
                healthUrl: "http://127.0.0.1:43127/api/health",
                startedAt: "2026-06-07T05:59:00.000Z",
            },
            native: {
                mark: { ok: true },
                logSlice: {
                    ok: true,
                    data: { selectedCount: 80 },
                },
                recentEvents: {
                    ok: true,
                    data: { returnedCount: 3, result: [{}, {}, {}] },
                },
            },
            sidecar: {
                debugEvents: { ok: true, returnedLines: 20 },
                observedEvents: { ok: true, returnedLines: 15 },
                observedHostileReport: {
                    ok: true,
                    summary: {
                        submissionReadyCount: 1,
                        readyForMaintainerReviewCount: 2,
                        needsIdentifierReviewCount: 3,
                    },
                },
            },
            lex: {
                attempted: true,
                ok: true,
                dryRun: true,
                skipped: false,
            },
            artifacts: {
                outputDir: "D:\\dev\\stfc-mod-sidecar\\.artifacts\\repro-bundle",
            },
            warnings: [],
        });

        expect(summary).toEqual({
            ok: true,
            protocolVersion: "stfc.sidecar.repro-bundle.ax.v1",
            detail: "repro-bundle-summary",
            generatedAt: "2026-06-07T06:00:00.000Z",
            label: "manual repro",
            modRepoRoot: "D:\\dev\\stfc-mod",
            sidecarRepoRoot: "D:\\dev\\stfc-mod-sidecar",
            serverUrl: "http://127.0.0.1:43127",
            summaryOnly: true,
            desktop: {
                mode: "managed-healthy",
                managed: true,
                healthy: true,
                running: true,
                pid: 1234,
                port: 43127,
                healthUrl: "http://127.0.0.1:43127/api/health",
                startedAt: "2026-06-07T05:59:00.000Z",
            },
            summary: {
                report: {
                    submissionReadyCount: 1,
                    readyForMaintainerReviewCount: 2,
                    needsIdentifierReviewCount: 3,
                },
                sidecarDebugReturned: 20,
                sidecarObservedReturned: 15,
                nativeLogSelectedCount: 80,
                nativeRecentEventsReturned: 3,
            },
            sections: {
                native: {
                    markOk: true,
                    logSliceOk: true,
                    recentEventsOk: true,
                },
                sidecar: {
                    debugEventsOk: true,
                    observedEventsOk: true,
                    observedHostileReportOk: true,
                },
                lex: {
                    attempted: true,
                    ok: true,
                    dryRun: true,
                    skipped: false,
                },
            },
            artifacts: {
                outputDir: "D:\\dev\\stfc-mod-sidecar\\.artifacts\\repro-bundle",
            },
            warnings: [],
            error: undefined,
        });
    });
});
