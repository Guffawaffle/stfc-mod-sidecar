import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
} from "../../viewer/community-mod-install.mjs";
import { buildCommunityModUninstallPlan } from "../../viewer/community-mod-uninstall-plan.mjs";
import {
    COMMUNITY_MOD_UNINSTALL_EXECUTION_ACKNOWLEDGEMENT,
    buildCommunityModUninstallConfirmation,
    buildCommunityModUninstallExecutionRequest,
    executeCommunityModUninstall,
} from "../../viewer/community-mod-uninstall-execution.mjs";

describe("Community Mod uninstall execution", () => {
    test("stays disabled unless execution is explicitly enabled", async () => {
        const fixture = await makeFixture({ action: "install" });
        const result = await executeCommunityModUninstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
        });

        expect(result).toMatchObject({
            status: "execution_disabled",
            safety: { writesGameDirectory: false },
            execution: { enabled: false, writesAttempted: false },
        });
        await expect(fs.access(fixture.dllPath)).resolves.toBeUndefined();
    });

    test("blocks at execution time while STFC is running", async () => {
        const fixture = await makeFixture({ action: "install" });
        const result = await executeCommunityModUninstall({
            confirmation: fixture.confirmation,
            gameProcess: { checked: true, running: true, processName: "prime.exe" },
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "game_running",
            execution: { writesAttempted: false },
        });
        await expect(fs.access(fixture.dllPath)).resolves.toBeUndefined();
    });

    test("removes a sidecar-owned fresh install and manifest", async () => {
        const fixture = await makeFixture({ action: "install" });
        const result = await executeCommunityModUninstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "removed",
            execution: { writesAttempted: true, writesCompleted: true },
            receipt: {
                destination: { removed: true, dllSha256: fixture.currentSha256 },
                backup: { required: false, created: false },
                manifest: { removed: true, path: fixture.manifestPath },
                settings: { policy: "leave_in_place", preserved: true, deleted: false, touched: false },
            },
        });
        await expect(fs.access(fixture.dllPath)).rejects.toThrow();
        await expect(fs.access(fixture.manifestPath)).rejects.toThrow();
        await expectSettingsArtifacts(fixture, true);
    });

    test("deletes settings and log artifacts when requested", async () => {
        const fixture = await makeFixture({ action: "install", deleteSettingsAndLogs: true });
        const result = await executeCommunityModUninstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "removed",
            receipt: {
                settings: {
                    policy: "delete_settings_and_logs",
                    preserved: false,
                    deleted: true,
                    touched: true,
                    deletedCount: fixture.artifactPaths.length,
                },
            },
            safety: { deleteSettingsAndLogs: true, settingsFilesTouched: true },
        });
        await expectSettingsArtifacts(fixture, false);
    });

    test("removes an unknown DLL without creating an uninstall backup", async () => {
        const fixture = await makeFixture({ unknown: true });
        const result = await executeCommunityModUninstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "removed",
            receipt: {
                destination: { removed: true, dllSha256: fixture.currentSha256 },
                backup: { required: false, created: false, path: "", dllSha256: "" },
                manifest: { removed: true },
                settings: { preserved: true, deleted: false, touched: false },
            },
        });
        expect(fixture.confirmation.target.backupPath).toBe("");
        await expect(fs.access(fixture.dllPath)).rejects.toThrow();
    });

    test("restores a trusted backup for a sidecar-owned replacement", async () => {
        const fixture = await makeFixture({ action: "replace_unknown", previousContents: "previous dll" });
        const result = await executeCommunityModUninstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "restored_backup",
            receipt: {
                destination: { restored: true, dllSha256: fixture.previousSha256 },
                backup: { used: true, path: fixture.backupPath, dllSha256: fixture.previousSha256 },
                manifest: { removed: true },
                settings: { preserved: true, deleted: false, touched: false },
            },
        });
        expect(await fs.readFile(fixture.dllPath, "utf8")).toBe("previous dll");
        await expect(fs.access(fixture.manifestPath)).rejects.toThrow();
    });

    test("refuses execution when the current DLL hash changed", async () => {
        const fixture = await makeFixture({ action: "install" });
        await fs.writeFile(fixture.dllPath, "tampered dll");

        const result = await executeCommunityModUninstall({
            confirmation: fixture.confirmation,
            gameProcess: stoppedGameProcess(),
            enableExecution: true,
        });

        expect(result).toMatchObject({
            status: "current_hash_mismatch",
            execution: { writesAttempted: false },
        });
        expect(await fs.readFile(fixture.dllPath, "utf8")).toBe("tampered dll");
    });

    test("request contract is server-disabled by default", async () => {
        const fixture = await makeFixture({ action: "install" });
        const request = buildCommunityModUninstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: explicitExecutionPayload(fixture),
            env: {},
        });

        expect(request).toMatchObject({
            status: "server_execution_disabled",
            requested: true,
            serverEnabled: false,
        });
    });

    test("request contract requires the prepared cleanup choice", async () => {
        const fixture = await makeFixture({ action: "install", deleteSettingsAndLogs: true });
        const payload = explicitExecutionPayload(fixture);
        payload.deleteSettingsAndLogs = false;

        const request = buildCommunityModUninstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload,
            env: { STFC_SIDECAR_ENABLE_MOD_UNINSTALL_EXECUTION: "1" },
        });

        expect(request).toMatchObject({
            status: "settings_cleanup_confirmation_required",
            confirmedDeleteSettingsAndLogs: false,
            expectedDeleteSettingsAndLogs: true,
        });
    });

    test("request contract is not enabled by the install execution flag", async () => {
        const fixture = await makeFixture({ action: "install" });
        const request = buildCommunityModUninstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: explicitExecutionPayload(fixture),
            env: { STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1" },
        });

        expect(request).toMatchObject({
            status: "server_execution_disabled",
            requested: true,
            serverEnabled: false,
        });
    });

    test("request contract accepts explicit uninstall confirmation", async () => {
        const fixture = await makeFixture({ action: "install" });
        const request = buildCommunityModUninstallExecutionRequest({
            confirmation: fixture.confirmation,
            payload: explicitExecutionPayload(fixture),
            env: { STFC_SIDECAR_ENABLE_MOD_UNINSTALL_EXECUTION: "1" },
        });

        expect(request).toMatchObject({
            status: "ready",
            requested: true,
            serverEnabled: true,
            acknowledgementAccepted: true,
            confirmedCurrentSha256: fixture.currentSha256,
            confirmedDestinationPath: fixture.dllPath,
            confirmedDeleteSettingsAndLogs: false,
        });
    });
});

async function makeFixture(options = {}) {
    const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-uninstall-game-"));
    const dllPath = path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE);
    const manifestPath = communityModInstallManifestPath(gameDirectory);
    const settingsPath = path.join(gameDirectory, "community_patch_settings.toml");
    const runtimeVarsPath = path.join(gameDirectory, "community_patch_runtime.vars");
    const logPath = path.join(gameDirectory, "community_patch.log");
    const battleFeedPath = path.join(gameDirectory, "community_patch_battle_feed.jsonl");
    const futureBattleFeedPath = path.join(gameDirectory, "community_patch_future_probe.jsonl");
    const artifactPaths = [settingsPath, runtimeVarsPath, logPath, battleFeedPath, futureBattleFeedPath];
    const currentContents = Buffer.from(options.currentContents ?? "current community mod dll");
    await fs.writeFile(dllPath, currentContents);
    await fs.writeFile(settingsPath, "refinery_diagnostics = false\n", "utf8");
    await fs.writeFile(runtimeVarsPath, "# generated vars\n", "utf8");
    await fs.writeFile(logPath, "community patch log\n", "utf8");
    await fs.writeFile(battleFeedPath, "{}\n", "utf8");
    await fs.writeFile(futureBattleFeedPath, "{}\n", "utf8");
    const currentSha256 = sha256(currentContents);
    const action = options.action ?? (options.unknown ? "unknown" : "install");
    let backupPath = "";
    let previousSha256 = "";

    if (action !== "unknown") {
        await fs.mkdir(path.dirname(manifestPath), { recursive: true });
        const manifest = {
            exists: true,
            schemaVersion: 2,
            distribution: "official-basic",
            profile: "netniv-basic",
            action,
            repo: "netniV/stfc-mod",
            tag: "v1.1.0",
            assetName: "stfc-community-mod-v1.1.0.zip",
            dllSha256: currentSha256,
            destinationPath: dllPath,
            manifestPath,
            backup: { required: false, created: false, path: "", sha256: "" },
            previous: { classification: "none", profile: "none", dllSha256: "", tag: "", assetName: "" },
        };

        if (action === "replace_unknown") {
            const previousContents = Buffer.from(options.previousContents ?? "previous community mod dll");
            previousSha256 = sha256(previousContents);
            backupPath = path.join(gameDirectory, ".stfc-sidecar", "backups", "version.dll.previous.bak");
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.writeFile(backupPath, previousContents);
            manifest.backup = { required: true, created: true, path: backupPath, sha256: previousSha256 };
            manifest.previous = { classification: "unknown", profile: "unknown", dllSha256: previousSha256, tag: "", assetName: "" };
        }

        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }

    const install = {
        ok: true,
        state: "installed",
        classification: action === "unknown" ? "unknown" : "netniv-basic",
        profile: action === "unknown" ? "unknown" : "netniv-basic",
        gameDirectory,
        dll: { exists: true, sha256: currentSha256 },
        manifest: action === "unknown"
            ? { exists: false }
            : JSON.parse(await fs.readFile(manifestPath, "utf8")),
    };
    const uninstallPlan = buildCommunityModUninstallPlan({ checkedAt: "2026-05-04T00:00:00.000Z", install });
    const confirmation = buildCommunityModUninstallConfirmation({
        checkedAt: "2026-05-04T00:00:00.000Z",
        uninstallPlan,
        gameProcess: stoppedGameProcess(),
        deleteSettingsAndLogs: options.deleteSettingsAndLogs,
        settingsFiles: [{ name: "community_patch_settings.toml", path: settingsPath, action: "leave_in_place" }],
    });

    if (options.expectReady !== false) {
        expect(confirmation.status).toBe("ready_for_confirmation");
    }
    return {
        gameDirectory,
        dllPath,
        manifestPath,
        settingsPath,
        artifactPaths,
        backupPath,
        currentSha256,
        previousSha256,
        uninstallPlan,
        confirmation,
        deleteSettingsAndLogs: options.deleteSettingsAndLogs === true,
    };
}

function stoppedGameProcess() {
    return { checked: true, running: false, processName: "prime.exe" };
}

function explicitExecutionPayload(fixture) {
    return {
        enableExecution: true,
        acknowledgement: COMMUNITY_MOD_UNINSTALL_EXECUTION_ACKNOWLEDGEMENT,
        confirmedCurrentSha256: fixture.currentSha256,
        confirmedDestinationPath: fixture.dllPath,
        deleteSettingsAndLogs: fixture.deleteSettingsAndLogs,
    };
}

async function expectSettingsArtifacts(fixture, shouldExist) {
    for (const artifactPath of fixture.artifactPaths) {
        if (shouldExist) {
            await expect(fs.access(artifactPath)).resolves.toBeUndefined();
        } else {
            await expect(fs.access(artifactPath)).rejects.toThrow();
        }
    }
}

function sha256(contents) {
    return createHash("sha256").update(contents).digest("hex").toUpperCase();
}