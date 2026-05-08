import { describe, expect, test } from "vitest";

import {
    buildCommunityModReleaseCatalog,
    communityModReleaseUnavailable,
    normalizeCommunityModReleaseProfile,
    selectCommunityModWindowsAsset,
} from "../../viewer/community-mod-release-catalog.mjs";

describe("community mod release catalog", () => {
    test("selects the official netniV stable Windows zip", () => {
        const result = buildCommunityModReleaseCatalog({
            checkedAt: "2026-05-03T00:00:00.000Z",
            profile: "netniv-basic",
            releases: [
                release("v1.2.0-alpha", {
                    prerelease: true,
                    assets: [asset("stfc-community-mod-v1.2.0-alpha.zip")],
                }),
                release("v1.1.0", {
                    assets: [
                        asset("stfc-community-mod.zip", { digest: "sha256:unversioned" }),
                        asset("stfc-community-mod-v1.1.0.zip", { digest: "sha256:versioned" }),
                    ],
                }),
            ],
        });

        expect(result).toMatchObject({
            status: "ready",
            installSupported: true,
            profile: "netniv-basic",
            repository: "netniV/stfc-mod",
            release: { tagName: "v1.1.0", prerelease: false },
            windowsAsset: {
                kind: "zip",
                name: "stfc-community-mod-v1.1.0.zip",
                digest: "sha256:versioned",
                expectedDllName: "version.dll",
            },
        });
    });

    test("selects the latest Guffawaffle tagged release for Guff Advanced installs", () => {
        const result = buildCommunityModReleaseCatalog({
            profile: "guff-advanced",
            releases: [
                release("v1.0.0-guffa.8", {
                    assets: [asset("version.dll", { digest: "sha256:older" }), asset("SHA256SUMS.txt")],
                }),
                release("v1.0.0-guffa.9", {
                    prerelease: true,
                    assets: [asset("version.dll", { digest: "sha256:latest" })],
                }),
            ],
        });

        expect(result).toMatchObject({
            status: "ready",
            installSupported: true,
            profile: "guff-advanced",
            repository: "Guffawaffle/stfc-mod",
            distribution: "advanced-alpha",
            release: { tagName: "v1.0.0-guffa.9", prerelease: true },
            windowsAsset: {
                kind: "dll",
                name: "version.dll",
                digest: "sha256:latest",
            },
        });
    });

    test("selects a Guffawaffle rc release when it is the newest compatible advanced build", () => {
        const result = buildCommunityModReleaseCatalog({
            profile: "guff-advanced",
            releases: [
                release("v1.0.0-guffa.8", {
                    assets: [asset("version.dll", { digest: "sha256:old" })],
                }),
                release("v1.1.0-guffa.1", {
                    prerelease: true,
                    assets: [asset("version.dll", { digest: "sha256:release" })],
                }),
                release("v1.1.0-guffa.rc1", {
                    prerelease: true,
                    assets: [
                        asset("version.dll", { digest: "sha256:rc" }),
                        asset("stfc-community-mod-v1.1.0-guffa.rc1.zip"),
                    ],
                }),
            ],
        });

        expect(result).toMatchObject({
            status: "ready",
            installSupported: true,
            profile: "guff-advanced",
            repository: "Guffawaffle/stfc-mod",
            release: { tagName: "v1.1.0-guffa.rc1", prerelease: true },
            windowsAsset: {
                kind: "dll",
                name: "version.dll",
                digest: "sha256:rc",
            },
        });
    });

    test("reports missing asset separately from missing release", () => {
        const result = buildCommunityModReleaseCatalog({
            profile: "netniv-basic",
            releases: [release("v1.1.0", { assets: [asset("stfc-community-mod-installer.dmg")] })],
        });

        expect(result).toMatchObject({
            status: "missing_windows_asset",
            installSupported: false,
            windowsAsset: null,
        });
    });

    test("represents unavailable release metadata without enabling install", () => {
        expect(communityModReleaseUnavailable({
            checkedAt: "2026-05-03T00:00:00.000Z",
            profile: "netniv-basic",
            error: "private repo",
        })).toMatchObject({
            status: "unavailable",
            installSupported: false,
            error: "private repo",
        });
    });

    test("normalizes profile aliases", () => {
        expect(normalizeCommunityModReleaseProfile("official")).toBe("netniv-basic");
        expect(normalizeCommunityModReleaseProfile("alpha")).toBe("guff-advanced");
        expect(normalizeCommunityModReleaseProfile("unknown")).toBe("netniv-basic");
    });

    test("falls back to unversioned netniV zip when the versioned zip is absent", () => {
        const selected = selectCommunityModWindowsAsset(
            release("v1.1.0", { assets: [asset("stfc-community-mod.zip")] }),
            { profile: "netniv-basic" },
        );

        expect(selected).toMatchObject({ name: "stfc-community-mod.zip", kind: "zip" });
    });
});

function release(tagName, options = {}) {
    return {
        tag_name: tagName,
        name: tagName,
        draft: false,
        prerelease: false,
        html_url: `https://github.com/netniV/stfc-mod/releases/tag/${tagName}`,
        published_at: "2026-05-03T00:00:00.000Z",
        assets: [],
        ...options,
    };
}

function asset(name, options = {}) {
    return {
        name,
        size: 1024,
        digest: "",
        content_type: "application/octet-stream",
        browser_download_url:
            `https://github.com/netniV/stfc-mod/releases/download/v1.1.0/${encodeURIComponent(name)}`,
        ...options,
    };
}