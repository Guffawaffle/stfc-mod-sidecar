import { compareReleaseVersions } from "./release-update.mjs";
import {
    COMMUNITY_MOD_RELEASE_PROFILES,
    normalizeCommunityModProfile,
} from "./community-mod-profiles.mjs";

const GITHUB_API_BASE_URL = "https://api.github.com/repos";

export { COMMUNITY_MOD_RELEASE_PROFILES };

export async function fetchCommunityModReleaseCatalog(options = {}) {
    const profile = normalizeCommunityModReleaseProfile(options.profile);
    const releaseProfile = COMMUNITY_MOD_RELEASE_PROFILES[profile];
    const repository = options.repository ?? releaseProfile.repository;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
        throw new Error("Community Mod release checks require fetch support");
    }

    const response = await fetchImpl(`${GITHUB_API_BASE_URL}/${repository}/releases`, {
        headers: {
            accept: "application/vnd.github+json",
            "user-agent": "stfc-mod-sidecar-mod-release-check",
        },
    });

    if (response.status === 404) {
        return communityModReleaseUnavailable({
            checkedAt: options.checkedAt,
            profile,
            repository,
            error: "Release metadata is not available for this repository",
        });
    }

    if (!response.ok) {
        throw new Error(`GitHub Community Mod release check failed: ${response.status}`);
    }

    const releases = await response.json();
    return buildCommunityModReleaseCatalog({
        checkedAt: options.checkedAt,
        profile,
        repository,
        releases: Array.isArray(releases) ? releases : [],
    });
}

export function buildCommunityModReleaseCatalog(options = {}) {
    const profile = normalizeCommunityModReleaseProfile(options.profile);
    const releaseProfile = COMMUNITY_MOD_RELEASE_PROFILES[profile];
    const repository = options.repository ?? releaseProfile.repository;
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const release = selectCommunityModRelease(options.releases ?? [], releaseProfile);

    if (!release) {
        return {
            ok: true,
            checkedAt,
            profile,
            distribution: releaseProfile.distribution,
            repository,
            status: "no_release",
            installSupported: false,
            release: null,
            windowsAsset: null,
            security: communityModReleaseSecurity(),
        };
    }

    const windowsAsset = selectCommunityModWindowsAsset(release, releaseProfile);
    const installSupported = Boolean(releaseProfile.installSupported && windowsAsset);
    return {
        ok: true,
        checkedAt,
        profile,
        distribution: releaseProfile.distribution,
        repository,
        status: windowsAsset ? "ready" : "missing_windows_asset",
        installSupported,
        unsupportedReason: installSupported
            ? ""
            : communityModReleaseUnsupportedReason(releaseProfile, windowsAsset),
        release: communityModReleaseSummary(release),
        windowsAsset,
        security: communityModReleaseSecurity(),
    };
}

export function communityModReleaseUnavailable(options = {}) {
    const profile = normalizeCommunityModReleaseProfile(options.profile);
    const releaseProfile = COMMUNITY_MOD_RELEASE_PROFILES[profile];
    return {
        ok: true,
        checkedAt: normalizeIsoTimestamp(options.checkedAt),
        profile,
        distribution: releaseProfile.distribution,
        repository: options.repository ?? releaseProfile.repository,
        status: "unavailable",
        installSupported: false,
        error: String(options.error ?? "Release metadata unavailable"),
        release: null,
        windowsAsset: null,
        security: communityModReleaseSecurity(),
    };
}

export function selectCommunityModRelease(releases, releaseProfile) {
    const candidates = releases.filter((release) => isEligibleCommunityModRelease(release, releaseProfile));
    candidates.sort((left, right) => compareReleaseVersions(releaseVersion(right), releaseVersion(left)));
    return candidates[0] ?? null;
}

export function selectCommunityModWindowsAsset(release, releaseProfile) {
    const assets = releaseAssets(release);
    if (releaseProfile.profile === "netniv-basic") {
        const tagName = String(release.tag_name ?? "");
        return assetSummary(
            assets.find((asset) => normalizedAssetName(asset) === `stfc-community-mod-${tagName.toLowerCase()}.zip`)
            ?? assets.find((asset) => normalizedAssetName(asset) === "stfc-community-mod.zip"),
            "zip",
        );
    }

    const dllAsset = assets.find((asset) => normalizedAssetName(asset) === "version.dll");
    const zipAsset = assets.find((asset) => /^stfc-community-mod-.+\.zip$/i.test(String(asset.name ?? "")))
        ?? assets.find((asset) => normalizedAssetName(asset) === "stfc-community-mod.zip");
    return assetSummary(dllAsset ?? zipAsset, dllAsset ? "dll" : "zip");
}

export function normalizeCommunityModReleaseProfile(value) {
    return normalizeCommunityModProfile(value);
}

function isEligibleCommunityModRelease(release, releaseProfile) {
    if (!release || release.draft) {
        return false;
    }

    if (releaseProfile.channel === "stable") {
        return !release.prerelease;
    }

    return true;
}

function communityModReleaseSummary(release) {
    return {
        tagName: String(release.tag_name ?? ""),
        name: String(release.name ?? release.tag_name ?? ""),
        version: releaseVersion(release),
        prerelease: Boolean(release.prerelease),
        htmlUrl: safeGithubReleaseUrl(release.html_url),
        publishedAt: release.published_at ?? release.created_at ?? null,
    };
}

function assetSummary(asset, kind) {
    if (!asset) {
        return null;
    }

    return {
        kind,
        name: String(asset.name ?? ""),
        size: Number.isFinite(asset.size) ? asset.size : 0,
        digest: String(asset.digest ?? ""),
        browserDownloadUrl: safeGithubReleaseUrl(asset.browser_download_url),
        contentType: String(asset.content_type ?? "application/octet-stream"),
        expectedDllName: "version.dll",
        requiresHashVerification: true,
    };
}

function communityModReleaseSecurity() {
    return {
        autoDownload: false,
        userConfirmationRequired: true,
        hashVerificationRequired: true,
        backupBeforeReplace: true,
    };
}

function communityModReleaseUnsupportedReason(releaseProfile, windowsAsset) {
    if (releaseProfile.unsupportedReason) {
        return releaseProfile.unsupportedReason;
    }

    return windowsAsset ? "Install is disabled for this profile." : "No supported Windows asset was found.";
}

function releaseVersion(release) {
    return String(release?.tag_name ?? "").trim().replace(/^v/i, "");
}

function releaseAssets(release) {
    return Array.isArray(release?.assets)
        ? release.assets.filter((asset) => safeGithubReleaseUrl(asset?.browser_download_url))
        : [];
}

function normalizedAssetName(asset) {
    return String(asset?.name ?? "").trim().toLowerCase();
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}

function safeGithubReleaseUrl(value) {
    const url = String(value ?? "").trim();
    return /^https:\/\/github\.com\/[^\s]+$/i.test(url) ? url : "";
}