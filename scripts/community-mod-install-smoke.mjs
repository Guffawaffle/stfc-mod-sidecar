#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
    detectCommunityModInstall,
} from "../packages/viewer/community-mod-install.mjs";
import {
    COMMUNITY_MOD_INSTALL_EXECUTION_ACKNOWLEDGEMENT,
    buildCommunityModInstallExecutionRequest,
    executeCommunityModInstall,
} from "../packages/viewer/community-mod-install-execution.mjs";

async function main() {
    const startedAt = Date.now();
    const install = await runExecutionSmoke({ action: "install" });
    const replace = await runExecutionSmoke({ action: "replace_unknown", existingDll: Buffer.from("previous version dll") });
    const success = install.status === "installed" && replace.status === "replaced";

    const receipt = {
        ok: success,
        smoke: "community-mod-install-execution",
        durationMs: Date.now() - startedAt,
        safety: {
            gameDirectoriesAreTemporary: true,
            realGameDirectoryTouched: false,
            executionEndpointEnabledByFixture: true,
        },
        install,
        replace,
    };
    console.log(JSON.stringify(receipt, null, 2));
    process.exit(success ? 0 : 1);
}

async function runExecutionSmoke(options = {}) {
    const fixture = await makeFixture(options);
    const request = buildCommunityModInstallExecutionRequest({
        confirmation: fixture.confirmation,
        payload: explicitExecutionPayload(fixture),
        env: { STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1" },
    });
    if (request.status !== "ready") {
        throw new Error(`Execution request was not ready: ${request.status}`);
    }

    const execution = await executeCommunityModInstall({
        checkedAt: fixture.checkedAt,
        confirmation: fixture.confirmation,
        gameProcess: { checked: true, running: false, processName: "prime.exe" },
        enableExecution: true,
    });
    const installedBytes = await fs.readFile(fixture.confirmation.target.destinationPath);
    const detected = await detectCommunityModInstall(fixture.gameDirectory, { readVersionInfo: async () => null });

    return {
        action: fixture.action,
        status: execution.status,
        requestStatus: request.status,
        gameDirectory: fixture.gameDirectory,
        destinationPath: fixture.confirmation.target.destinationPath,
        backupPath: execution.receipt?.backup?.path ?? "",
        manifestPath: execution.receipt?.manifest?.path ?? "",
        dllSha256: sha256(installedBytes),
        expectedDllSha256: fixture.stagedSha256,
        detectedClassification: detected.classification,
        writesAttempted: execution.execution?.writesAttempted === true,
        writesCompleted: execution.execution?.writesCompleted === true,
        backupCreated: execution.receipt?.backup?.created === true,
    };
}

async function makeFixture(options = {}) {
    const checkedAt = new Date().toISOString();
    const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-mod-smoke-game-"));
    const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-mod-smoke-cache-"));
    const stagedPath = path.join(cacheDirectory, COMMUNITY_MOD_DLL_FILE);
    const stagedBytes = Buffer.from(`${options.action ?? "install"} staged community mod dll`);
    await fs.writeFile(stagedPath, stagedBytes);
    const stagedSha256 = sha256(stagedBytes);

    if (options.existingDll) {
        await fs.writeFile(path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE), options.existingDll);
    }

    const action = options.action ?? "install";
    const backupRequired = action !== "install";
    const catalog = basicCatalog();
    const confirmation = {
        ok: true,
        status: "ready_for_confirmation",
        action,
        profile: "netniv-basic",
        target: {
            gameDirectory,
            destinationPath: path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE),
            backupPath: backupRequired
                ? path.join(gameDirectory, ".stfc-sidecar", "backups", "version.dll.smoke.bak")
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
        confirmation: {
            acknowledgement: COMMUNITY_MOD_INSTALL_EXECUTION_ACKNOWLEDGEMENT,
        },
        artifactStaging: {
            status: "staged",
            catalog,
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
            catalog,
        },
        warnings: [],
    };

    return { action, checkedAt, gameDirectory, stagedSha256, confirmation };
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

void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});