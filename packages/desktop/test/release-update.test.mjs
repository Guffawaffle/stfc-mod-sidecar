import { describe, expect, it } from "vitest";

import { buildReleaseInfo } from "../../viewer/release-info.mjs";
import {
    buildReleaseUpdateCheck,
    compareReleaseVersions,
    normalizeReleaseRepository,
    releaseUpdateUnavailable,
    selectReleaseCandidate,
} from "../../viewer/release-update.mjs";

describe("release update checks", () => {
    it("selects prerelease updates for alpha channels", () => {
        const result = buildReleaseUpdateCheck({
            checkedAt: "2026-05-03T00:00:00.000Z",
            currentRelease: buildReleaseInfo({ version: "0.0.1-Alpha", packaged: true }),
            releases: [release("v0.0.2-Alpha", { prerelease: true })],
        });

        expect(result).toMatchObject({
            status: "update_available",
            updateAvailable: true,
            latest: {
                version: "0.0.2-Alpha",
                prerelease: true,
            },
            security: {
                autoDownload: false,
                authenticodeRequired: true,
            },
        });
    });

    it("keeps stable channels away from prerelease candidates", () => {
        const candidate = selectReleaseCandidate(
            [release("v0.0.3-Alpha", { prerelease: true }), release("v0.0.2")],
            "stable",
        );

        expect(candidate.tag_name).toBe("v0.0.2");
    });

    it("reports up to date when the newest eligible release is not newer", () => {
        const result = buildReleaseUpdateCheck({
            currentRelease: buildReleaseInfo({ version: "0.0.2-Alpha", packaged: true }),
            releases: [release("v0.0.2-Alpha", { prerelease: true })],
        });

        expect(result).toMatchObject({
            status: "up_to_date",
            updateAvailable: false,
        });
    });

    it("summarizes only Windows executable assets as signed release candidates", () => {
        const result = buildReleaseUpdateCheck({
            currentRelease: buildReleaseInfo({ version: "0.0.1-Alpha", packaged: true }),
            releases: [
                release("v0.0.2-Alpha", {
                    prerelease: true,
                    assets: [
                        asset("STFC Community Mod Companion-Setup-0.0.2-Alpha-x64.exe"),
                        asset("STFC Community Mod Companion-Setup-0.0.2-Alpha-x64.exe.blockmap"),
                    ],
                }),
            ],
        });

        expect(result.latest.signedWindowsAssets).toHaveLength(1);
        expect(result.latest.signedWindowsAssets[0]).toMatchObject({
            name: "STFC Community Mod Companion-Setup-0.0.2-Alpha-x64.exe",
            authenticodeRequired: true,
        });
    });

    it("normalizes supported repository formats", () => {
        expect(normalizeReleaseRepository("https://github.com/Guffawaffle/stfc-mod-sidecar.git")).toBe(
            "Guffawaffle/stfc-mod-sidecar",
        );
        expect(normalizeReleaseRepository("nope")).toBeNull();
    });

    it("represents inaccessible release metadata without offering an update", () => {
        const result = releaseUpdateUnavailable({
            checkedAt: "2026-05-03T00:00:00.000Z",
            currentRelease: buildReleaseInfo({ version: "0.0.1-Alpha", packaged: true }),
            repository: "Guffawaffle/stfc-mod-sidecar",
            error: "Release metadata is not available for this repository",
        });

        expect(result).toMatchObject({
            status: "unavailable",
            updateAvailable: false,
            latest: null,
            error: "Release metadata is not available for this repository",
        });
    });

    it("orders semver prerelease channels conservatively", () => {
        expect(compareReleaseVersions("0.0.2", "0.0.2-Alpha")).toBeGreaterThan(0);
        expect(compareReleaseVersions("0.0.2-Beta", "0.0.2-Alpha")).toBeGreaterThan(0);
        expect(compareReleaseVersions("0.0.2-Alpha", "0.0.1")).toBeGreaterThan(0);
        expect(compareReleaseVersions("1.0.0-guffa.9", "1.0.0-guffa.8")).toBeGreaterThan(0);
    });
});

function release(tagName, options = {}) {
    return {
        tag_name: tagName,
        name: tagName,
        draft: false,
        prerelease: false,
        html_url: `https://github.com/Guffawaffle/stfc-mod-sidecar/releases/tag/${tagName}`,
        published_at: "2026-05-03T00:00:00.000Z",
        assets: [],
        ...options,
    };
}

function asset(name) {
    return {
        name,
        size: 1024,
        content_type: "application/octet-stream",
        browser_download_url: `https://github.com/Guffawaffle/stfc-mod-sidecar/releases/download/v0.0.2-Alpha/${encodeURIComponent(name)}`,
    };
}