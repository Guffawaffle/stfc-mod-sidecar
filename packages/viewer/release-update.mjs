const DEFAULT_RELEASE_REPOSITORY = "Guffawaffle/stfc-mod-sidecar";
const GITHUB_API_BASE_URL = "https://api.github.com/repos";

export async function fetchReleaseUpdateCheck(options = {}) {
    const repository = normalizeReleaseRepository(options.repository) ?? DEFAULT_RELEASE_REPOSITORY;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
        throw new Error("Update checks require fetch support");
    }

    const response = await fetchImpl(`${GITHUB_API_BASE_URL}/${repository}/releases`, {
        headers: {
            accept: "application/vnd.github+json",
            "user-agent": "stfc-mod-sidecar-update-check",
        },
    });

    if (response.status === 404) {
        return releaseUpdateUnavailable({
            checkedAt: options.checkedAt,
            currentRelease: options.currentRelease,
            repository,
            error: "Release metadata is not available for this repository",
        });
    }

    if (!response.ok) {
        throw new Error(`GitHub release check failed: ${response.status}`);
    }

    const releases = await response.json();
    return buildReleaseUpdateCheck({
        checkedAt: options.checkedAt,
        currentRelease: options.currentRelease,
        releases: Array.isArray(releases) ? releases : [],
        repository,
    });
}

export function releaseUpdateUnavailable(options = {}) {
    return {
        ok: true,
        checkedAt: normalizeIsoTimestamp(options.checkedAt),
        repository: normalizeReleaseRepository(options.repository) ?? DEFAULT_RELEASE_REPOSITORY,
        status: "unavailable",
        updateAvailable: false,
        error: String(options.error ?? "Release metadata unavailable"),
        current: releaseCurrentSummary(options.currentRelease ?? {}),
        latest: null,
        security: releaseUpdateSecuritySummary(),
    };
}

export function buildReleaseUpdateCheck(options = {}) {
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);
    const repository = normalizeReleaseRepository(options.repository) ?? DEFAULT_RELEASE_REPOSITORY;
    const currentRelease = options.currentRelease ?? {};
    const channel = currentRelease.channel ?? "development";
    const candidate = selectReleaseCandidate(options.releases ?? [], channel);

    if (!candidate) {
        return {
            ok: true,
            checkedAt,
            repository,
            status: "no_release",
            updateAvailable: false,
            current: releaseCurrentSummary(currentRelease),
            latest: null,
            security: releaseUpdateSecuritySummary(),
        };
    }

    const latest = releaseSummary(candidate);
    const updateAvailable = compareReleaseVersions(latest.version, currentRelease.version) > 0;
    return {
        ok: true,
        checkedAt,
        repository,
        status: updateAvailable ? "update_available" : "up_to_date",
        updateAvailable,
        current: releaseCurrentSummary(currentRelease),
        latest,
        security: releaseUpdateSecuritySummary(),
    };
}

export function selectReleaseCandidate(releases, channel) {
    const candidates = releases.filter((release) => isEligibleRelease(release, channel));
    candidates.sort((left, right) => compareReleaseVersions(releaseVersion(right), releaseVersion(left)));
    return candidates[0] ?? null;
}

export function compareReleaseVersions(left, right) {
    const leftVersion = parseReleaseVersion(left);
    const rightVersion = parseReleaseVersion(right);
    if (!leftVersion || !rightVersion) {
        return String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
    }

    for (const key of ["major", "minor", "patch"]) {
        if (leftVersion[key] !== rightVersion[key]) {
            return leftVersion[key] - rightVersion[key];
        }
    }

    const rankComparison = prereleaseRank(leftVersion.prerelease) - prereleaseRank(rightVersion.prerelease);
    if (rankComparison !== 0) {
        return rankComparison;
    }

    return leftVersion.prerelease.localeCompare(rightVersion.prerelease, undefined, { numeric: true, sensitivity: "base" });
}

export function normalizeReleaseRepository(value) {
    const repository = String(value ?? "").trim();
    if (!repository) {
        return null;
    }

    const githubMatch = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i.exec(repository);
    const normalized = githubMatch ? githubMatch[1] : repository.replace(/\.git$/i, "");
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

function isEligibleRelease(release, channel) {
    if (!release || release.draft) {
        return false;
    }

    if (channel === "stable") {
        return !release.prerelease;
    }

    return true;
}

function releaseSummary(release) {
    return {
        tagName: String(release.tag_name ?? ""),
        name: String(release.name ?? release.tag_name ?? ""),
        version: releaseVersion(release),
        prerelease: Boolean(release.prerelease),
        htmlUrl: safeGithubReleaseUrl(release.html_url),
        publishedAt: release.published_at ?? release.created_at ?? null,
        signedWindowsAssets: releaseAssets(release).map((asset) => ({
            name: String(asset.name ?? ""),
            size: Number.isFinite(asset.size) ? asset.size : 0,
            browserDownloadUrl: safeGithubReleaseUrl(asset.browser_download_url),
            contentType: String(asset.content_type ?? "application/octet-stream"),
            authenticodeRequired: true,
        })),
    };
}

function releaseCurrentSummary(release) {
    return {
        version: String(release.version ?? ""),
        channel: String(release.channel ?? "development"),
        channelLabel: String(release.channelLabel ?? "Development"),
        updateMode: String(release.updateMode ?? "manual"),
        signaturePolicy: String(release.signaturePolicy ?? "local_unsigned"),
    };
}

function releaseUpdateSecuritySummary() {
    return {
        autoDownload: false,
        authenticodeRequired: true,
    };
}

function releaseVersion(release) {
    const tagName = String(release?.tag_name ?? "").trim();
    return tagName.replace(/^v/i, "");
}

function releaseAssets(release) {
    return Array.isArray(release?.assets)
        ? release.assets.filter((asset) => /\.exe$/i.test(String(asset?.name ?? "")) && safeGithubReleaseUrl(asset.browser_download_url))
        : [];
}

function parseReleaseVersion(value) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?/i.exec(String(value ?? "").trim());
    if (!match) {
        return null;
    }

    return {
        major: Number.parseInt(match[1], 10),
        minor: Number.parseInt(match[2], 10),
        patch: Number.parseInt(match[3], 10),
        prerelease: match[4]?.toLowerCase() ?? "",
    };
}

function prereleaseRank(value) {
    if (!value) {
        return 4;
    }

    if (value.includes("rc")) {
        return 3;
    }

    if (value.includes("beta")) {
        return 2;
    }

    if (value.includes("alpha")) {
        return 1;
    }

    return 0;
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}

function safeGithubReleaseUrl(value) {
    const url = String(value ?? "").trim();
    return /^https:\/\/github\.com\/[^\s]+$/i.test(url) ? url : "";
}