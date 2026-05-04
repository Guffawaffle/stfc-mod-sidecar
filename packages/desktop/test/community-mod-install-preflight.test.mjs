import { describe, expect, test } from "vitest";

import { buildCommunityModInstallPreflight } from "../../viewer/community-mod-install-preflight.mjs";

describe("Community Mod install preflight", () => {
    test("returns ready for confirmation when plan, artifact, and process checks are safe", () => {
        const preflight = buildCommunityModInstallPreflight({
            checkedAt: "2026-05-04T00:00:00.000Z",
            installPlan: installPlan({ action: "install", actionLabel: "Install available" }),
            artifactVerification: verifiedArtifact(),
            gameProcess: { checked: true, running: false },
        });

        expect(preflight).toMatchObject({
            status: "ready_for_confirmation",
            action: "install",
            confirmation: {
                required: true,
                action: "install",
                backupRequired: false,
            },
            safety: {
                dryRun: true,
                writesGameDirectory: false,
                userConfirmationRequired: true,
                gameProcessMustBeStopped: true,
            },
            execution: { enabled: false },
        });
    });

    test("blocks preflight while prime.exe is running", () => {
        const preflight = buildCommunityModInstallPreflight({
            installPlan: installPlan({ action: "update", actionLabel: "Update available" }),
            artifactVerification: verifiedArtifact(),
            gameProcess: {
                checked: true,
                running: true,
                matches: [{ Id: 42, ProcessName: "prime", Path: "C:\\Games\\Star Trek Fleet Command\\prime.exe" }],
            },
        });

        expect(preflight).toMatchObject({
            status: "game_running",
            action: "stop_game",
            gameProcess: {
                running: true,
                matches: [{ pid: 42, name: "prime" }],
            },
            safety: { writesGameDirectory: false },
        });
    });

    test("blocks preflight when process status cannot be checked", () => {
        const preflight = buildCommunityModInstallPreflight({
            installPlan: installPlan({ action: "install" }),
            artifactVerification: verifiedArtifact(),
            gameProcess: { checked: false, running: false, error: "PowerShell unavailable" },
        });

        expect(preflight).toMatchObject({
            status: "game_process_check_unavailable",
            action: "inspect",
            warnings: ["Game process status is unknown."],
        });
    });

    test("requires artifact verification before confirmation", () => {
        const preflight = buildCommunityModInstallPreflight({
            installPlan: installPlan({ action: "replace_unknown" }),
            artifactVerification: { status: "hash_mismatch", summary: "Downloaded artifact SHA-256 did not match." },
            gameProcess: { checked: true, running: false },
        });

        expect(preflight).toMatchObject({
            status: "artifact_not_verified",
            action: "verify_artifact",
            confirmation: { required: false },
            warnings: ["Unknown installed DLL provenance.", "Artifact status is hash_mismatch."],
        });
    });

    test("does not preflight non-actionable plans", () => {
        const preflight = buildCommunityModInstallPreflight({
            installPlan: installPlan({ action: "none", actionLabel: "No install action", status: "current" }),
            artifactVerification: verifiedArtifact(),
            gameProcess: { checked: true, running: false },
        });

        expect(preflight).toMatchObject({
            status: "no_install_action",
            action: "none",
            confirmation: { required: false },
        });
    });

    test("requires backups for replace/update style confirmations", () => {
        const preflight = buildCommunityModInstallPreflight({
            installPlan: installPlan({ action: "replace_unknown", actionLabel: "Replace unknown DLL" }),
            artifactVerification: verifiedArtifact(),
            gameProcess: { checked: true, running: false },
        });

        expect(preflight).toMatchObject({
            status: "ready_for_confirmation",
            confirmation: { backupRequired: true },
            warnings: ["Unknown installed DLL provenance."],
        });
    });
});

function installPlan(options = {}) {
    return {
        ok: true,
        profile: "netniv-basic",
        status: options.status ?? "install_available",
        action: options.action ?? "install",
        actionLabel: options.actionLabel ?? "Install available",
        summary: "Selected release can proceed after confirmation.",
        warnings: options.action === "replace_unknown" ? ["Unknown installed DLL provenance."] : [],
        safety: { writesGameDirectory: false },
        execution: { enabled: false },
        target: { assetName: "stfc-community-mod-v1.1.0.zip" },
    };
}

function verifiedArtifact() {
    return {
        ok: true,
        status: "verified",
        summary: "Community Mod artifact hash and structure verified.",
        artifact: {
            actualSha256: "945E73F7A122E4D7C374A1E5BB847339C2831DD6390B8B907E991A993E9797EA",
            inspection: { status: "ready", dllEntry: "version.dll" },
        },
        safety: { writesGameDirectory: false },
    };
}