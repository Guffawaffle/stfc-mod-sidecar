import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSidecarIngestEnvelope } from "../../viewer/server/sidecar-ingest.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");
const corpusDirectory = path.join(repositoryRoot, "examples", "battle-bridge-golden-v1");
const validator = path.join(repositoryRoot, "scripts", "validate-battle-bridge-golden.mjs");

describe("Battle Bridge golden corpus", () => {
    it("passes the portable evidence and redaction validator", () => {
        const result = runValidator(corpusDirectory);

        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
            ok: true,
            payloadFixtures: 2,
            acceptedRuntimeContracts: [],
            fleetAlertProducerEvidence: "unproven-current-producer",
        });
    });

    it.each(["battle-capture.json", "fleet-runtime.json"])(
        "freezes the complete production parser result for %s",
        (fileName) => {
            const fixture = JSON.parse(readFileSync(path.join(corpusDirectory, fileName), "utf8"));
            expect(parseSidecarIngestEnvelope(fixture.envelope)).toEqual(fixture.expectedParsedEnvelope);
        },
    );

    it("rejects duplicate object keys before JSON.parse can shadow them", () => {
        withCorpusCopy((copy) => {
            const file = path.join(copy, "corpus.json");
            const raw = readFileSync(file, "utf8");
            writeFileSync(file, raw.replace('  "status":', '  "sta\\u0074us": "shadowed",\n  "status":'), "utf8");
            const result = runValidator(copy);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("duplicate key 'status'");
        });
    });

    it("rejects canonicalized credential-key variants", () => {
        withCorpusCopy((copy) => {
            const file = path.join(copy, "battle-capture.json");
            const raw = readFileSync(file, "utf8");
            writeFileSync(file, raw.replace('  "synthetic":', '  "OAuthClientSecret": "private",\n  "synthetic":'), "utf8");
            const result = runValidator(copy);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toMatch(/private\/secret raw pattern|forbidden key/u);
        });
    });

    it("allows Battle token fields only at the canonical capture paths", () => {
        withCorpusCopy((copy) => {
            const file = path.join(copy, "battle-capture.json");
            const raw = readFileSync(file, "utf8");
            writeFileSync(
                file,
                raw.replace('  "synthetic":', '  "some": { "capture": { "battleLog": { "tokens": ["private"] } } },\n  "synthetic":'),
                "utf8",
            );
            const result = runValidator(copy);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("forbidden key $.some.capture.battleLog.tokens");
        });
    });

    it("rejects duplicate fixture contract filenames", () => {
        withCorpusCopy((copy) => {
            const file = path.join(copy, "corpus.json");
            const corpus = JSON.parse(readFileSync(file, "utf8"));
            corpus.fixtureContracts[1].file = corpus.fixtureContracts[0].file;
            writeFileSync(file, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
            const result = runValidator(copy);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("duplicate fixture contract");
        });
    });

    it("cannot represent an accepted contract in the provisional schema", () => {
        withCorpusCopy((copy) => {
            const file = path.join(copy, "corpus.json");
            const corpus = JSON.parse(readFileSync(file, "utf8"));
            corpus.capabilityEvidence[0].status = "accepted-runtime-contract";
            corpus.capabilityEvidence[0].acceptedRuntimeContract = true;
            writeFileSync(file, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
            const result = runValidator(copy);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain("status this provisional schema cannot represent");
        });
    });
});

function runValidator(directory) {
    return spawnSync(process.execPath, [validator, directory], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
    });
}

function withCorpusCopy(action) {
    const root = mkdtempSync(path.join(os.tmpdir(), "battle-bridge-golden-"));
    const copy = path.join(root, "corpus");
    cpSync(corpusDirectory, copy, { recursive: true });
    try {
        action(copy);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}
