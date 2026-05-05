import { describe, expect, test } from "vitest";

import { buildCommunityModInstallPlan } from "../../viewer/community-mod-install-plan.mjs";

describe("Community Mod install plan", () => {
    test("plans an install when no DLL is present", () => {
        const plan = buildCommunityModInstallPlan({
            checkedAt: "2026-05-04T00:00:00.000Z",
            profile: "netniv-basic",
            install: install({ state: "none", classification: "none" }),
            catalog: readyCatalog(),
        });

        expect(plan).toMatchObject({
            status: "install_available",
            action: "install",
            actionLabel: "Install available",
            execution: { enabled: false },
            safety: {
                dryRun: true,
                writesGameDirectory: false,
                backupBeforeReplace: true,
            },
        });
    });

    test("reports current when installed release matches the catalog", () => {
        const plan = buildCommunityModInstallPlan({
            profile: "netniv-basic",
            install: install({
                classification: "netniv-basic",
                matchedRelease: { tag: "v1.1.0", assetName: "stfc-community-mod-v1.1.0.zip" },
            }),
            catalog: readyCatalog(),
        });

        expect(plan).toMatchObject({
            status: "current",
            action: "none",
            current: { tag: "v1.1.0" },
            target: { tag: "v1.1.0" },
        });
    });

    test("plans an update when the selected release is newer", () => {
        const plan = buildCommunityModInstallPlan({
            profile: "netniv-basic",
            install: install({ classification: "netniv-basic", matchedRelease: { tag: "v1.0.0" } }),
            catalog: readyCatalog(),
        });

        expect(plan).toMatchObject({
            status: "update_available",
            action: "update",
            actionLabel: "Update available",
        });
    });

    test("requires explicit replacement planning for unknown DLLs", () => {
        const plan = buildCommunityModInstallPlan({
            profile: "netniv-basic",
            install: install({ classification: "unknown" }),
            catalog: readyCatalog(),
        });

        expect(plan).toMatchObject({
            status: "unknown_install_detected",
            action: "replace_unknown",
            warnings: ["Unknown installed DLL provenance."],
        });
    });

    test("plans an advanced alpha install from a supported Guffawaffle release", () => {
        const plan = buildCommunityModInstallPlan({
            profile: "guff-advanced",
            install: install({ state: "none", classification: "none" }),
            catalog: readyCatalog({
                profile: "guff-advanced",
                distribution: "advanced-alpha",
                repository: "Guffawaffle/stfc-mod",
                release: { tagName: "v1.0.0-guffa.9", version: "1.0.0-guffa.9" },
                windowsAsset: { name: "version.dll", digest: "sha256:latest" },
            }),
        });

        expect(plan).toMatchObject({
            status: "install_available",
            action: "install",
            profile: "guff-advanced",
            target: {
                repository: "Guffawaffle/stfc-mod",
                tag: "v1.0.0-guffa.9",
                assetName: "version.dll",
            },
        });
    });

    test("blocks install planning on platforms without an implemented install flow", () => {
        const plan = buildCommunityModInstallPlan({
            platform: "darwin",
            profile: "netniv-basic",
            install: install({ state: "none", classification: "none" }),
            catalog: readyCatalog(),
        });

        expect(plan).toMatchObject({
            status: "platform_unsupported",
            action: "none",
            summary: "macOS Community Mod install/update is not implemented yet.",
            platform: {
                platform: "darwin",
                installPlanningSupported: false,
            },
            execution: {
                enabled: false,
                reason: "macOS Community Mod install/update is not implemented yet.",
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
        gameDirectory: "C:\\Games\\Star Trek Fleet Command\\default\\game",
        dll: {
            exists: true,
            sha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA",
        },
        manifest: { exists: false },
        ...options,
    };
}

function readyCatalog(options = {}) {
    return {
        ok: true,
        profile: "netniv-basic",
        distribution: "official-basic",
        repository: "netniV/stfc-mod",
        status: "ready",
        installSupported: true,
        release: {
            tagName: "v1.1.0",
            version: "1.1.0",
            htmlUrl: "https://github.com/netniV/stfc-mod/releases/tag/v1.1.0",
        },
        windowsAsset: {
            name: "stfc-community-mod-v1.1.0.zip",
            digest: "sha256:945e73f7a122e4d7c374a1e5bb847339c2831dd6390b8b907e991a993e9797ea",
        },
        ...options,
    };
}