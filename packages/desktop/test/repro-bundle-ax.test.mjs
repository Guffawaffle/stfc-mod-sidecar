import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { buildReproBundleLexFrame, parseReproBundleAxArgs, resolveNpxInvocation } from "../../../scripts/repro-bundle-ax.mjs";

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
            "--json-out",
            ".artifacts/repro-bundle.json",
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
            jsonOut: ".artifacts/repro-bundle.json",
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
        expect(familyManifest.commands["repro-bundle"].argsSchema.properties["json-out"].type).toBe("string");
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
});
