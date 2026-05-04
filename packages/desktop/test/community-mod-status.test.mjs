import { describe, expect, test } from "vitest";

import {
    communityModInstallLabel,
    communityModInstallSummary,
    communityModInstallTone,
    communityModReleaseLabel,
    communityModReleaseSummary,
    communityModInstallPlanLabel,
    communityModInstallPlanSummary,
    modProfileLabel,
} from "../../viewer/public/shared/community-mod-status.js";

describe("Community Mod status formatting", () => {
    test("formats official Basic installs with release evidence", () => {
        const install = {
            ok: true,
            state: "installed",
            classification: "netniv-basic",
            matchedRelease: {
                owner: "netniV",
                repo: "stfc-mod",
                tag: "v1.1.0",
            },
            dll: {
                sha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA",
                versionInfo: { fileVersion: "1.1.0.0" },
            },
        };

        expect(communityModInstallLabel(install)).toBe("Official Basic installed");
        expect(communityModInstallSummary(install)).toContain("netniV/stfc-mod v1.1.0");
        expect(communityModInstallSummary(install)).toContain("SHA-256 45DBE5FA43E2...");
        expect(communityModInstallTone(install)).toBe("info");
    });

    test("treats unknown DLLs as warning status", () => {
        const install = {
            ok: true,
            state: "installed",
            classification: "unknown",
            dll: { sha256: "D0F1418D61803762F8AA2DDC2F8C807616C8FA20D2437A32C4358B1DE7AD6961" },
        };

        expect(communityModInstallLabel(install)).toBe("Unknown version.dll installed");
        expect(communityModInstallTone(install)).toBe("warning");
    });

    test("formats mod release catalog states", () => {
        const catalog = {
            ok: true,
            profile: "netniv-basic",
            repository: "netniV/stfc-mod",
            status: "ready",
            installSupported: true,
            release: {
                version: "1.1.0",
                tagName: "v1.1.0",
                htmlUrl: "https://github.com/netniV/stfc-mod/releases/tag/v1.1.0",
            },
            windowsAsset: {
                name: "stfc-community-mod-v1.1.0.zip",
                digest: "sha256:945e73f7a122e4d7c374a1e5bb847339c2831dd6390b8b907e991a993e9797ea",
            },
        };

        expect(communityModReleaseLabel(catalog)).toBe("1.1.0 ready");
        expect(communityModReleaseSummary(catalog)).toContain("stfc-community-mod-v1.1.0.zip");
        expect(modProfileLabel("netniv-basic")).toBe("Official Basic");
    });

    test("keeps Advanced Alpha release metadata distinct from install support", () => {
        const catalog = {
            ok: true,
            profile: "guff-advanced",
            repository: "Guffawaffle/stfc-mod",
            status: "ready",
            installSupported: false,
            unsupportedReason: "Install disabled until release marker exists.",
            release: { tagName: "v1.0.0-guffa.8" },
            windowsAsset: { name: "version.dll" },
        };

        expect(communityModReleaseLabel(catalog)).toBe("Advanced Alpha metadata ready");
        expect(communityModReleaseSummary(catalog)).toContain("Install disabled until release marker exists.");
    });

    test("formats install/update plans without implying execution is enabled", () => {
        const plan = {
            ok: true,
            status: "update_available",
            action: "update",
            actionLabel: "Update available",
            summary: "v1.1.0 is newer than installed v1.0.0.",
            target: { tag: "v1.1.0", assetName: "stfc-community-mod-v1.1.0.zip" },
            execution: { enabled: false },
            warnings: [],
        };

        expect(communityModInstallPlanLabel(plan)).toBe("Update available");
        expect(communityModInstallPlanSummary(plan)).toContain("Manual confirmation path not enabled yet");
    });
});