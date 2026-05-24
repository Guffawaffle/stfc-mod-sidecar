import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
    LOCAL_SIDECAR_CONFIG_FILE,
    localSidecarConfigPath,
    readLocalSidecarConfig,
} from "../../viewer/local-sidecar-config.mjs";

describe("local sidecar config", () => {
    let tempDir = "";

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { force: true, recursive: true });
            tempDir = "";
        }
    });

    test("fails closed when the local config file is missing", async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), "sidecar-local-config-"));
        const config = await readLocalSidecarConfig(tempDir);

        expect(config.ok).toBe(true);
        expect(config.exists).toBe(false);
        expect(config.path).toBe(localSidecarConfigPath(tempDir));
        expect(config.unsafeAllowUnrecognizedInstalledDll).toBe(false);
    });

    test("enables the unsafe override only for literal boolean true", async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), "sidecar-local-config-"));
        await writeLocalConfig(tempDir, { unsafeAllowUnrecognizedInstalledDll: true });

        await expectUnsafeOverride(tempDir, true);
    });

    test.each([
        ["false", { unsafeAllowUnrecognizedInstalledDll: false }],
        ["string true", { unsafeAllowUnrecognizedInstalledDll: "true" }],
        ["string false", { unsafeAllowUnrecognizedInstalledDll: "false" }],
        ["number one", { unsafeAllowUnrecognizedInstalledDll: 1 }],
        ["object", { unsafeAllowUnrecognizedInstalledDll: {} }],
        ["array", { unsafeAllowUnrecognizedInstalledDll: [true] }],
        ["missing", {}],
    ])("keeps the unsafe override disabled for %s", async (_label, configValue) => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), "sidecar-local-config-"));
        await writeLocalConfig(tempDir, configValue);

        await expectUnsafeOverride(tempDir, false);
    });

    test("keeps the unsafe override disabled for invalid JSON", async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), "sidecar-local-config-"));
        const configPath = localSidecarConfigPath(tempDir);
        await mkdir(path.dirname(configPath), { recursive: true });
        await writeFile(configPath, "{", "utf8");

        const config = await readLocalSidecarConfig(tempDir);

        expect(config.ok).toBe(false);
        expect(config.exists).toBe(true);
        expect(config.unsafeAllowUnrecognizedInstalledDll).toBe(false);
    });

    test("ships an explicit unsafe override example with the safe default", async () => {
        const examplePath = path.resolve(import.meta.dirname, "../../../examples/sidecar-local-config.example.json");
        const example = JSON.parse(await readFile(examplePath, "utf8"));

        expect(example).toEqual({ unsafeAllowUnrecognizedInstalledDll: false });
        expect(examplePath.endsWith(path.join("examples", LOCAL_SIDECAR_CONFIG_FILE.replace(".json", ".example.json")))).toBe(true);
    });
});

async function writeLocalConfig(tempDir, value) {
    const configPath = localSidecarConfigPath(tempDir);
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function expectUnsafeOverride(tempDir, expected) {
    const config = await readLocalSidecarConfig(tempDir);

    expect(config.ok).toBe(true);
    expect(config.exists).toBe(true);
    expect(config.unsafeAllowUnrecognizedInstalledDll).toBe(expected);
}