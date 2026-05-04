import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
    detectCommunityModInstall,
} from "../../viewer/community-mod-install.mjs";
import {
    COMMUNITY_MOD_INSTALL_EXECUTION_ACKNOWLEDGEMENT,
    buildCommunityModInstallExecutionBlocked,
    buildCommunityModInstallExecutionRequest,
    executeCommunityModInstall,
} from "../../viewer/community-mod-install-execution.mjs";

describe("Community Mod install execution", () => {
    test("stays disabled unless execution is explicitly enabled", async () => {
        const fixture = await makeFixture();
        const result = await executeCommunityModInstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
        });

        expect(result).toMatchObject({
            status: "execution_disabled",
            safety: { writesGameDirectory: false, writesSidecarCache: false },
            execution: { enabled: false, writesAttempted: false },
        });
        await expect(fs.access(path.join(fixture.gameDirectory, COMMUNITY_MOD_DLL_FILE))).rejects.toThrow();
    });

    test("blocks at execution time while STFC is running", async () => {
        const fixture = await makeFixture();
        const result = await executeCommunityModInstall({
            confirmation: fixture.confirmation,
            gameProcess: { checked: true, running: true, processName: "prime.exe" },
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "game_running",
            safety: { writesGameDirectory: false },
            execution: { writesAttempted: false },
        });
        await expect(fs.access(path.join(fixture.gameDirectory, COMMUNITY_MOD_DLL_FILE))).rejects.toThrow();
    });

    test("blocks execution on platforms without an implemented install flow", async () => {
        const fixture = await makeFixture();
        const result = await executeCommunityModInstall({
            platform: "darwin",
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "platform_unsupported",
            summary: "macOS Community Mod install/update is not implemented yet.",
            safety: { writesGameDirectory: false },
            execution: { writesAttempted: false },
        });
        await expect(fs.access(path.join(fixture.gameDirectory, COMMUNITY_MOD_DLL_FILE))).rejects.toThrow();
    });

    test("installs a staged DLL into a temp game directory and writes a manifest", async () => {
        const fixture = await makeFixture({ checkedAt: "2026-05-04T08:00:00.000Z" });
        const result = await executeCommunityModInstall({
            checkedAt: "2026-05-04T08:00:00.000Z",
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "installed",
            safety: {
                writesGameDirectory: true,
                writesSidecarCache: false,
                postCopyHashVerificationRequired: true,
                manifestWriteRequired: true,
            },
            execution: { writesAttempted: true, writesCompleted: true },
            receipt: {
                destination: { dllSha256: fixture.stagedSha256 },
                backup: { required: false, created: false, path: "" },
                manifest: { written: true },
            },
        });

        const installed = await fs.readFile(path.join(fixture.gameDirectory, COMMUNITY_MOD_DLL_FILE));
        expect(sha256(installed)).toBe(fixture.stagedSha256);

        const manifest = JSON.parse(await fs.readFile(communityModInstallManifestPath(fixture.gameDirectory), "utf8"));
        expect(manifest).toMatchObject({
            schemaVersion: 1,
            distribution: "official-basic",
            repo: "netniV/stfc-mod",
            tag: "v1.1.0",
            assetName: "stfc-community-mod-v1.1.0.zip",
            dllSha256: fixture.stagedSha256,
            installedAt: "2026-05-04T08:00:00.000Z",
        });

        const detected = await detectCommunityModInstall(fixture.gameDirectory, { readVersionInfo: async () => null });
        expect(detected).toMatchObject({
            state: "installed",
            classification: "netniv-basic",
            manifest: { profile: "netniv-basic", tag: "v1.1.0" },
        });
    });

    test("backs up an existing DLL before replacement", async () => {
        const originalDll = Buffer.from("original version dll");
        const fixture = await makeFixture({ action: "replace_unknown", existingDll: originalDll });
        const result = await executeCommunityModInstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "replaced",
            receipt: {
                backup: { required: true, created: true, path: fixture.confirmation.target.backupPath },
                destination: { dllSha256: fixture.stagedSha256 },
            },
        });
        expect(await fs.readFile(fixture.confirmation.target.backupPath, "utf8")).toBe(originalDll.toString());
        expect(sha256(await fs.readFile(path.join(fixture.gameDirectory, COMMUNITY_MOD_DLL_FILE)))).toBe(fixture.stagedSha256);
    });

    test("refuses execution when the staged DLL hash changed", async () => {
        const fixture = await makeFixture();
        await fs.writeFile(fixture.stagedPath, "tampered dll");

        const result = await executeCommunityModInstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "staged_hash_mismatch",
            safety: { writesGameDirectory: false },
            execution: { writesAttempted: false },
        });
        await expect(fs.access(path.join(fixture.gameDirectory, COMMUNITY_MOD_DLL_FILE))).rejects.toThrow();
    });

    test("request contract stays server-disabled by default", async () => {
        const fixture = await makeFixture();
        const request = buildCommunityModInstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: explicitExecutionPayload(fixture),
            env: {},
        });

        expect(request).toMatchObject({
            status: "server_execution_disabled",
            requested: true,
            serverEnabled: false,
        });

        const blocked = buildCommunityModInstallExecutionBlocked({ confirmation: fixture.confirmation, executionRequest: request });
        expect(blocked).toMatchObject({
            status: "server_execution_disabled",
            safety: { writesGameDirectory: false, writesSidecarCache: false },
            execution: { enabled: false, writesAttempted: false },
        });
    });

    test("request contract blocks unsupported platforms before write handling", async () => {
        const fixture = await makeFixture();
        const request = buildCommunityModInstallExecutionRequest({
            platform: "darwin",
            confirmation: fixture.confirmation,
            payload: explicitExecutionPayload(fixture),
            env: { STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1" },
        });

        expect(request).toMatchObject({
            status: "platform_unsupported",
            requested: true,
            serverEnabled: true,
            platform: { platform: "darwin", installExecutionSupported: false },
        });
    });

    test("request contract requires exact acknowledgement text", async () => {
        const fixture = await makeFixture();
        const request = buildCommunityModInstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: { ...explicitExecutionPayload(fixture), acknowledgement: "yes really" },
            env: { STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1" },
        });

        expect(request).toMatchObject({
            status: "acknowledgement_required",
            acknowledgementAccepted: false,
        });
    });

    test("request contract requires matching staged hash and destination", async () => {
        const fixture = await makeFixture();
        const hashRequest = buildCommunityModInstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: { ...explicitExecutionPayload(fixture), confirmedStagedSha256: "ABC" },
            env: { STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1" },
        });
        const destinationRequest = buildCommunityModInstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: { ...explicitExecutionPayload(fixture), confirmedDestinationPath: path.join(fixture.gameDirectory, "wrong.dll") },
            env: { STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1" },
        });

        expect(hashRequest.status).toBe("staged_hash_confirmation_required");
        expect(destinationRequest.status).toBe("destination_confirmation_required");
    });

    test("request contract accepts a fully explicit execution request", async () => {
        const fixture = await makeFixture();
        const request = buildCommunityModInstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: explicitExecutionPayload(fixture),
            env: { STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "true" },
        });

        expect(request).toMatchObject({
            status: "ready",
            requested: true,
            serverEnabled: true,
            acknowledgementAccepted: true,
            confirmedStagedSha256: fixture.stagedSha256,
            confirmedDestinationPath: fixture.confirmation.target.destinationPath,
        });
    });
});

async function makeFixture(options = {}) {
    const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-execution-game-"));
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-execution-cache-"));
    const stagedPath = path.join(cacheDirectory, "version.dll");
    const stagedBytes = Buffer.from(options.stagedContents ?? "official netniv staged dll");
    await fs.writeFile(stagedPath, stagedBytes);
    const stagedSha256 = sha256(stagedBytes);

    if (options.existingDll) {
        await fs.writeFile(path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE), options.existingDll);
    }

    const action = options.action ?? "install";
    const backupRequired = action !== "install";
    const confirmation = {
        ok: true,
        status: "ready_for_confirmation",
        action,
        profile: "netniv-basic",
        target: {
            gameDirectory,
            destinationPath: path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE),
            backupPath: backupRequired
                ? path.join(gameDirectory, ".stfc-sidecar", "backups", "version.dll.test.bak")
                : "",
            manifestPath: communityModInstallManifestPath(gameDirectory),
        },
        staged: {
            path: stagedPath,
            bytes: stagedBytes.length,
            dllSha256: stagedSha256,
        },
        safety: {
            writesGameDirectory: false,
            writesSidecarCache: true,
            backupBeforeReplace: backupRequired,
        },
        artifactStaging: {
            status: "staged",
            catalog: basicCatalog(),
            staged: {
                path: stagedPath,
                bytes: stagedBytes.length,
                dllSha256: stagedSha256,
            },
            safety: { writesGameDirectory: false, writesSidecarCache: true },
        },
        installPlan: {
            profile: "netniv-basic",
            target: {
                tag: "v1.1.0",
                assetName: "stfc-community-mod-v1.1.0.zip",
            },
            catalog: basicCatalog(),
        },
        warnings: [],
    };

    return { gameDirectory, cacheDirectory, stagedPath, stagedSha256, confirmation };
}

function basicCatalog() {
    return {
        profile: "netniv-basic",
        distribution: "official-basic",
        repository: "netniV/stfc-mod",
        release: { tagName: "v1.1.0" },
        windowsAsset: { name: "stfc-community-mod-v1.1.0.zip" },
    };
}

function stoppedGameProcess() {
    return { checked: true, running: false, processName: "prime.exe" };
}

function explicitExecutionPayload(fixture) {
    return {
        enableExecution: true,
        acknowledgement: COMMUNITY_MOD_INSTALL_EXECUTION_ACKNOWLEDGEMENT,
        confirmedStagedSha256: fixture.stagedSha256,
        confirmedDestinationPath: fixture.confirmation.target.destinationPath,
    };
}

function sha256(contents) {
    return createHash("sha256").update(contents).digest("hex").toUpperCase();
}