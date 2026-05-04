import path from "node:path";

import { describe, expect, test } from "vitest";

import { buildCommunityModInstallConfirmation } from "../../viewer/community-mod-install-confirmation.mjs";

describe("Community Mod install confirmation", () => {
    test("builds a replace confirmation with backup and staged hash details", () => {
        const confirmation = buildCommunityModInstallConfirmation({
            checkedAt: "2026-05-04T00:00:00.000Z",
            preflight: readyPreflight({ action: "replace_unknown", backupRequired: true }),
            artifactStaging: stagedArtifact(),
        });

        expect(confirmation).toMatchObject({
            status: "ready_for_confirmation",
            action: "replace_unknown",
            confirmation: {
                required: true,
                enabled: false,
                action: "replace_unknown",
                primaryActionLabel: "Install execution not enabled",
            },
            staged: {
                dllSha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA",
            },
            target: {
                destinationPath: path.join(gameDirectory(), "version.dll"),
                manifestPath: path.join(gameDirectory(), ".stfc-sidecar", "community-mod-install.json"),
            },
            safety: {
                writesGameDirectory: false,
                writesSidecarCache: true,
                backupBeforeReplace: true,
                executionTimeGameProcessCheckRequired: true,
                postCopyHashVerificationRequired: true,
                manifestWriteRequired: true,
            },
            execution: { enabled: false },
        });
        expect(confirmation.target.backupPath).toContain(`${path.sep}.stfc-sidecar${path.sep}backups${path.sep}`);
        expect(confirmation.confirmation.checks.every((check) => check.passed)).toBe(true);
    });

    test("does not require a backup path for a fresh install confirmation", () => {
        const confirmation = buildCommunityModInstallConfirmation({
            preflight: readyPreflight({ action: "install", backupRequired: false, installState: "none" }),
            artifactStaging: stagedArtifact(),
        });

        expect(confirmation).toMatchObject({
            status: "ready_for_confirmation",
            action: "install",
            target: { backupPath: "" },
            safety: { backupBeforeReplace: false },
        });
        expect(confirmation.confirmation.checks.find((check) => check.id === "backup_planned")).toMatchObject({
            passed: true,
            label: "Backup not required for fresh install",
        });
    });

    test("blocks confirmation when preflight is blocked", () => {
        const confirmation = buildCommunityModInstallConfirmation({
            preflight: blockedPreflight(),
            artifactStaging: stagedArtifact(),
        });

        expect(confirmation).toMatchObject({
            status: "game_running",
            summary: "Close Star Trek Fleet Command before installing or replacing version.dll.",
            confirmation: { required: false, enabled: false },
            warnings: ["prime.exe is running.", "Install confirmation is blocked by preflight."],
        });
    });

    test("blocks confirmation when version.dll is not staged", () => {
        const confirmation = buildCommunityModInstallConfirmation({
            preflight: readyPreflight({ action: "update", backupRequired: true }),
            artifactStaging: { status: "artifact_cache_mismatch", summary: "Cached artifact SHA-256 no longer matches." },
        });

        expect(confirmation).toMatchObject({
            status: "artifact_cache_mismatch",
            confirmation: { required: false },
            warnings: ["Staged version.dll is not available."],
        });
    });
});

function readyPreflight(options = {}) {
    const action = options.action ?? "replace_unknown";
    const backupRequired = options.backupRequired ?? action !== "install";
    return {
        ok: true,
        status: "ready_for_confirmation",
        action,
        actionLabel: "Replace unknown DLL",
        summary: "Replace unknown DLL is ready for explicit confirmation. No files have been changed.",
        profile: "netniv-basic",
        installPlan: installPlan({ action, installState: options.installState }),
        gameProcess: { checked: true, running: false, processName: "prime.exe", matches: [] },
        confirmation: {
            required: true,
            action,
            title: action === "install" ? "Install available" : "Replace unknown DLL",
            backupRequired,
        },
        warnings: action === "replace_unknown" ? ["Unknown installed DLL provenance."] : [],
    };
}

function blockedPreflight() {
    return {
        ok: true,
        status: "game_running",
        action: "stop_game",
        summary: "Close Star Trek Fleet Command before installing or replacing version.dll.",
        profile: "netniv-basic",
        installPlan: installPlan({ action: "replace_unknown" }),
        gameProcess: { checked: true, running: true, processName: "prime.exe" },
        confirmation: { required: false, action: "stop_game", title: "No confirmation available" },
        warnings: ["prime.exe is running."],
    };
}

function installPlan(options = {}) {
    const state = options.installState ?? "installed";
    return {
        ok: true,
        profile: "netniv-basic",
        action: options.action ?? "replace_unknown",
        actionLabel: "Replace unknown DLL",
        install: {
            ok: true,
            state,
            classification: state === "none" ? "none" : "unknown",
            gameDirectory: gameDirectory(),
            dll: {
                exists: state !== "none",
                sha256: "D0F1418D61803762F8AA2DDC2F8C807616C8FA20D2437A32C4358B1DE7AD6961",
            },
        },
    };
}

function stagedArtifact() {
    return {
        ok: true,
        status: "staged",
        summary: "Community Mod version.dll staged in the sidecar cache.",
        staged: {
            path: path.join("C:\\Users\\Guff\\AppData\\Local\\Temp", "staged", "version.dll"),
            bytes: 10860032,
            dllSha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA",
        },
        safety: { writesGameDirectory: false, writesSidecarCache: true },
    };
}

function gameDirectory() {
    return "C:\\Games\\Star Trek Fleet Command\\default\\game";
}