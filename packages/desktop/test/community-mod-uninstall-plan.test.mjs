import path from "node:path";

import { describe, expect, test } from "vitest";

import { buildCommunityModUninstallPlan } from "../../viewer/community-mod-uninstall-plan.mjs";

describe("Community Mod uninstall plan", () => {
    test("reports no action when version.dll is missing", () => {
        const plan = buildCommunityModUninstallPlan({
            checkedAt: "2026-05-04T00:00:00.000Z",
            install: install({ state: "none", classification: "none", dll: { exists: false } }),
        });

        expect(plan).toMatchObject({
            status: "no_install_detected",
            action: "none",
            actionLabel: "No uninstall action",
            safety: {
                dryRun: true,
                writesGameDirectory: false,
                staleManifestBlocked: true,
            },
        });
    });

    test("plans removal for a sidecar-owned fresh install", () => {
        const gameDirectory = gameDir();
        const plan = buildCommunityModUninstallPlan({
            checkedAt: "2026-05-04T00:00:00.000Z",
            install: install({
                gameDirectory,
                manifest: manifest({ action: "install" }),
            }),
        });

        expect(plan).toMatchObject({
            status: "fresh_install_removable",
            action: "remove_fresh_install",
            actionLabel: "Remove sidecar install",
            target: {
                gameDirectory,
                destinationPath: path.join(gameDirectory, "version.dll"),
                manifestPath: path.join(gameDirectory, ".stfc-sidecar", "community-mod-install.json"),
            },
            execution: { enabled: false },
        });
    });

    test("plans backup restore for a sidecar-owned replacement with durable metadata", () => {
        const backupPath = path.join(gameDir(), ".stfc-sidecar", "backups", "version.dll.previous.bak");
        const plan = buildCommunityModUninstallPlan({
            install: install({
                manifest: manifest({
                    action: "replace_unknown",
                    backup: {
                        required: true,
                        created: true,
                        path: backupPath,
                        sha256: previousSha(),
                    },
                    previous: {
                        classification: "unknown",
                        profile: "unknown",
                        dllSha256: previousSha(),
                    },
                }),
            }),
        });

        expect(plan).toMatchObject({
            status: "replacement_restore_available",
            action: "restore_backup",
            actionLabel: "Restore previous DLL",
            target: {
                backupPath,
                backupSha256: previousSha(),
            },
        });
    });

    test("blocks automated uninstall when manifest hash is stale", () => {
        const plan = buildCommunityModUninstallPlan({
            install: install({ manifest: manifest({ dllSha256: previousSha() }) }),
        });

        expect(plan).toMatchObject({
            status: "stale_manifest",
            action: "none",
            warnings: ["Sidecar manifest does not match the current DLL hash."],
        });
    });

    test("plans direct removal for unknown DLLs", () => {
        const plan = buildCommunityModUninstallPlan({
            checkedAt: "2026-05-04T00:00:00.000Z",
            install: install({ classification: "unknown", profile: "unknown", manifest: { exists: false } }),
        });

        expect(plan).toMatchObject({
            status: "unknown_install_removable",
            action: "remove_unknown",
            actionLabel: "Remove DLL",
            warnings: ["Unknown DLL provenance."],
            safety: { backupBeforeUnknownRemoval: false, unknownRemovalCreatesBackup: false },
        });
        expect(plan.target.backupPath).toBe("");
    });

    test("plans direct removal for known manual installs when no trusted sidecar manifest exists", () => {
        const plan = buildCommunityModUninstallPlan({
            install: install({ manifest: { exists: false } }),
        });

        expect(plan).toMatchObject({
            status: "manual_install_removable",
            action: "remove_unknown",
            warnings: ["No trusted sidecar install manifest was found."],
        });
    });

    test("blocks uninstall planning on unsupported platforms", () => {
        const plan = buildCommunityModUninstallPlan({
            platform: "darwin",
            install: install({ state: "installed", manifest: manifest({ action: "install" }) }),
        });

        expect(plan).toMatchObject({
            status: "platform_unsupported",
            action: "none",
            summary: "macOS Community Mod uninstall is not implemented yet.",
            platform: {
                platform: "darwin",
                installPlanningSupported: false,
            },
            execution: {
                enabled: false,
                reason: "macOS Community Mod uninstall is not implemented yet.",
            },
        });
    });
});

function install(options = {}) {
    return {
        ok: true,
        state: "installed",
        classification: "netniv-basic",
        profile: "netniv-basic",
        gameDirectory: gameDir(),
        dll: {
            exists: true,
            sha256: currentSha(),
        },
        manifest: { exists: false },
        ...options,
    };
}

function manifest(options = {}) {
    return {
        exists: true,
        path: path.join(gameDir(), ".stfc-sidecar", "community-mod-install.json"),
        schemaVersion: 2,
        distribution: "official-basic",
        profile: "netniv-basic",
        action: "install",
        repo: "netniV/stfc-mod",
        tag: "v1.1.0",
        assetName: "stfc-community-mod-v1.1.0.zip",
        dllSha256: currentSha(),
        destinationPath: path.join(gameDir(), "version.dll"),
        manifestPath: path.join(gameDir(), ".stfc-sidecar", "community-mod-install.json"),
        backup: {
            required: false,
            created: false,
            path: "",
            sha256: "",
        },
        previous: {
            classification: "none",
            profile: "none",
            dllSha256: "",
            tag: "",
            assetName: "",
        },
        ...options,
    };
}

function gameDir() {
    return "C:\\Games\\Star Trek Fleet Command\\default\\game";
}

function currentSha() {
    return "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA";
}

function previousSha() {
    return "D0F1418D61803762F8AA2DDC2F8C807616C8FA20D2437A32C4358B1DE7AD6961";
}
