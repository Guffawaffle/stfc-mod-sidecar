import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    findExpectedDllEntry,
    isUnsafeZipEntry,
    readCommunityModZipEntries,
} from "./community-mod-zip.mjs";

const DEFAULT_MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

export async function verifyCommunityModArtifact(options = {}) {
    const catalog = options.catalog ?? null;
    const cacheDir = options.cacheDir;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);

    if (!catalog || catalog.ok === false || catalog.status === "error") {
        return artifactVerificationResult({
            checkedAt,
            status: "release_status_unavailable",
            summary: String(catalog?.error ?? "Community Mod release status is unavailable."),
        });
    }

    if (catalog.status !== "ready") {
        return artifactVerificationResult({
            checkedAt,
            status: "release_not_ready",
            summary: "Selected Community Mod release is not ready for artifact verification.",
            catalog,
        });
    }

    if (!catalog.installSupported) {
        return artifactVerificationResult({
            checkedAt,
            status: "profile_unsupported",
            summary: catalog.unsupportedReason ?? "Artifact verification is not supported for this profile.",
            catalog,
        });
    }

    const asset = catalog.windowsAsset;
    if (!asset?.browserDownloadUrl || !safeGithubReleaseUrl(asset.browserDownloadUrl)) {
        return artifactVerificationResult({
            checkedAt,
            status: "missing_download_url",
            summary: "Selected Community Mod release does not expose a safe GitHub download URL.",
            catalog,
        });
    }

    if (Number.isFinite(asset.size) && asset.size > maxBytes) {
        return artifactVerificationResult({
            checkedAt,
            status: "artifact_too_large",
            summary: `Selected artifact is larger than the ${maxBytes} byte safety limit.`,
            catalog,
            artifact: artifactSummary(asset),
        });
    }

    if (typeof fetchImpl !== "function") {
        throw new Error("Community Mod artifact verification requires fetch support");
    }

    const cachePath = artifactCachePath(cacheDir, catalog, asset);
    const expectedSha256 = normalizeSha256(asset.digest);
    if (!expectedSha256) {
        return artifactVerificationResult({
            checkedAt,
            status: "trusted_digest_required",
            summary: "Selected Community Mod artifact does not include trusted SHA-256 release metadata.",
            catalog,
            artifact: artifactSummary(asset, { expectedSha256 }),
        });
    }

    const cached = await readCachedArtifact(cachePath, expectedSha256).catch(() => null);
    const artifactBuffer = cached?.buffer ?? await downloadArtifact(asset, fetchImpl, maxBytes);
    const actualSha256 = sha256Buffer(artifactBuffer);

    if (expectedSha256 && actualSha256 !== expectedSha256) {
        return artifactVerificationResult({
            checkedAt,
            status: "hash_mismatch",
            summary: "Downloaded artifact SHA-256 did not match GitHub release metadata.",
            catalog,
            artifact: artifactSummary(asset, { actualSha256, expectedSha256 }),
        });
    }

    const inspection = inspectCommunityModArtifact(artifactBuffer, asset);
    if (inspection.status !== "ready") {
        return artifactVerificationResult({
            checkedAt,
            status: inspection.status,
            summary: inspection.summary,
            catalog,
            artifact: artifactSummary(asset, { actualSha256, expectedSha256, inspection }),
        });
    }

    if (!cached) {
        await mkdir(path.dirname(cachePath), { recursive: true });
        await writeFile(cachePath, artifactBuffer);
    }

    return artifactVerificationResult({
        checkedAt,
        status: "verified",
        summary: "Community Mod artifact hash and structure verified.",
        catalog,
        artifact: artifactSummary(asset, { actualSha256, expectedSha256, inspection }),
        cache: {
            path: cachePath,
            bytes: artifactBuffer.length,
            reused: Boolean(cached),
        },
    });
}

export function inspectCommunityModArtifact(buffer, asset) {
    if (asset.kind === "dll") {
        const expectedName = String(asset.expectedDllName ?? "version.dll").toLowerCase();
        const actualName = String(asset.name ?? "").toLowerCase();
        return actualName === expectedName
            ? { status: "ready", kind: "dll", dllEntry: asset.name }
            : {
                status: "missing_expected_dll",
                kind: "dll",
                summary: `Expected ${asset.expectedDllName ?? "version.dll"} but selected artifact is ${asset.name}.`,
            };
    }

    if (asset.kind !== "zip") {
        return {
            status: "unsupported_artifact_kind",
            kind: asset.kind,
            summary: `Unsupported Community Mod artifact kind: ${asset.kind ?? "unknown"}.`,
        };
    }

    const zipEntries = readCommunityModZipEntries(buffer);
    const entries = zipEntries.map((entry) => entry.name);
    const unsafeEntries = zipEntries.filter((entry) => isUnsafeZipEntry(entry)).map((entry) => entry.name);
    if (unsafeEntries.length > 0) {
        return {
            status: "unsafe_zip_entries",
            kind: "zip",
            summary: "Zip artifact contains unsafe entry paths.",
            entries,
            unsafeEntries,
        };
    }

    const dllEntry = findExpectedDllEntry(zipEntries, asset.expectedDllName ?? "version.dll")?.name ?? "";
    if (!dllEntry) {
        return {
            status: "missing_expected_dll",
            kind: "zip",
            summary: `Zip artifact does not contain ${asset.expectedDllName ?? "version.dll"}.`,
            entries,
        };
    }

    return {
        status: "ready",
        kind: "zip",
        dllEntry,
        entries,
    };
}

function artifactVerificationResult(result) {
    return {
        ok: true,
        checkedAt: result.checkedAt,
        status: result.status,
        summary: result.summary,
        catalog: result.catalog ?? null,
        artifact: result.artifact ?? null,
        cache: result.cache ?? null,
        safety: {
            writesGameDirectory: false,
            hashVerificationRequired: true,
            structureInspectionRequired: true,
        },
    };
}

async function readCachedArtifact(cachePath, expectedSha256) {
    const buffer = await readFile(cachePath);
    return sha256Buffer(buffer) === expectedSha256 ? { buffer } : null;
}

async function downloadArtifact(asset, fetchImpl, maxBytes) {
    const response = await fetchImpl(asset.browserDownloadUrl, {
        headers: {
            accept: "application/octet-stream",
            "user-agent": "stfc-mod-sidecar-mod-artifact-verifier",
        },
    });
    if (!response.ok) {
        throw new Error(`Community Mod artifact download failed: ${response.status}`);
    }

    const contentLength = Number.parseInt(response.headers?.get?.("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new Error(`Community Mod artifact exceeds ${maxBytes} bytes`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
        throw new Error(`Community Mod artifact exceeds ${maxBytes} bytes`);
    }

    return buffer;
}

function artifactSummary(asset, options = {}) {
    return {
        kind: String(asset.kind ?? ""),
        name: String(asset.name ?? ""),
        expectedDllName: String(asset.expectedDllName ?? "version.dll"),
        size: Number.isFinite(asset.size) ? asset.size : 0,
        expectedSha256: options.expectedSha256 ?? normalizeSha256(asset.digest),
        actualSha256: options.actualSha256 ?? "",
        browserDownloadUrl: safeGithubReleaseUrl(asset.browserDownloadUrl),
        inspection: options.inspection ?? null,
    };
}

function artifactCachePath(cacheDir, catalog, asset) {
    const baseDir = cacheDir ? path.resolve(cacheDir) : path.resolve(".sidecar", "mod-artifacts");
    return path.join(
        baseDir,
        sanitizePathSegment(catalog.profile),
        sanitizePathSegment(catalog.release?.tagName ?? "release"),
        sanitizePathSegment(asset.name),
    );
}

function sha256Buffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function normalizeSha256(value) {
    return String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
}

function normalizeIsoTimestamp(value) {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date().toISOString() : timestamp.toISOString();
}

function sanitizePathSegment(value) {
    return String(value ?? "").trim().replace(/[^0-9A-Za-z._-]+/g, "_").replace(/^\.+$/, "_") || "artifact";
}

function safeGithubReleaseUrl(value) {
    const url = String(value ?? "").trim();
    return /^https:\/\/github\.com\/[^\s]+$/i.test(url) ? url : "";
}