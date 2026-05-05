import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    extractZipEntry,
    findExpectedDllEntry,
    isUnsafeZipEntry,
    readCommunityModZipEntries,
} from "./community-mod-zip.mjs";

const DEFAULT_MAX_STAGED_DLL_BYTES = 64 * 1024 * 1024;

export async function stageCommunityModArtifact(options = {}) {
    const catalog = options.catalog ?? null;
    const verification = options.verification ?? null;
    const cacheDir = options.cacheDir;
    const stageDir = options.stageDir;
    const maxDllBytes = options.maxDllBytes ?? DEFAULT_MAX_STAGED_DLL_BYTES;
    const checkedAt = normalizeIsoTimestamp(options.checkedAt);

    if (!catalog || catalog.ok === false || catalog.status === "error") {
        return stagingResult({
            checkedAt,
            status: "release_status_unavailable",
            summary: String(catalog?.error ?? "Community Mod release status is unavailable."),
        });
    }

    if (catalog.status !== "ready") {
        return stagingResult({
            checkedAt,
            status: "release_not_ready",
            summary: "Selected Community Mod release is not ready for artifact staging.",
            catalog,
        });
    }

    if (!verification || verification.status !== "verified") {
        return stagingResult({
            checkedAt,
            status: "artifact_not_verified",
            summary: verification?.summary ?? "Verify the Community Mod artifact before staging.",
            catalog,
            artifactVerification: verification,
        });
    }

    const asset = catalog.windowsAsset;
    const cachePath = verification.cache?.path;
    if (!asset || !cachePath) {
        return stagingResult({
            checkedAt,
            status: "artifact_cache_unavailable",
            summary: "Verified artifact cache path is unavailable.",
            catalog,
            artifactVerification: verification,
        });
    }

    const artifactBuffer = await readFile(cachePath);
    const expectedArtifactSha256 = normalizeSha256(asset.digest);
    if (!expectedArtifactSha256) {
        return stagingResult({
            checkedAt,
            status: "trusted_digest_required",
            summary: "Selected Community Mod artifact does not include trusted SHA-256 release metadata.",
            catalog,
            artifactVerification: verification,
            artifact: { expectedSha256: "", actualSha256: "" },
        });
    }

    const actualArtifactSha256 = sha256Buffer(artifactBuffer);
    if (actualArtifactSha256 !== expectedArtifactSha256) {
        return stagingResult({
            checkedAt,
            status: "artifact_cache_mismatch",
            summary: "Cached artifact SHA-256 no longer matches release metadata.",
            catalog,
            artifactVerification: verification,
            artifact: { expectedSha256: expectedArtifactSha256, actualSha256: actualArtifactSha256 },
        });
    }

    const extraction = extractExpectedDll(artifactBuffer, asset, maxDllBytes);
    if (extraction.status !== "ready") {
        return stagingResult({
            checkedAt,
            status: extraction.status,
            summary: extraction.summary,
            catalog,
            artifactVerification: verification,
            artifact: { expectedSha256: expectedArtifactSha256, actualSha256: actualArtifactSha256 },
            extraction,
        });
    }

    const stagedPath = artifactStagePath(stageDir ?? cacheDir, catalog, asset);
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, extraction.buffer);

    return stagingResult({
        checkedAt,
        status: "staged",
        summary: "Community Mod version.dll staged in the sidecar cache.",
        catalog,
        artifactVerification: verification,
        artifact: { expectedSha256: expectedArtifactSha256, actualSha256: actualArtifactSha256 },
        extraction: {
            kind: extraction.kind,
            dllEntry: extraction.dllEntry,
        },
        staged: {
            path: stagedPath,
            bytes: extraction.buffer.length,
            dllSha256: sha256Buffer(extraction.buffer),
        },
    });
}

function extractExpectedDll(buffer, asset, maxDllBytes) {
    const expectedDllName = String(asset.expectedDllName ?? "version.dll");
    if (asset.kind === "dll") {
        const actualName = String(asset.name ?? "");
        if (actualName.toLowerCase() !== expectedDllName.toLowerCase()) {
            return {
                status: "missing_expected_dll",
                kind: "dll",
                summary: `Expected ${expectedDllName} but selected artifact is ${actualName}.`,
            };
        }

        if (buffer.length > maxDllBytes) {
            return {
                status: "staged_dll_too_large",
                kind: "dll",
                summary: `Extracted DLL is larger than the ${maxDllBytes} byte safety limit.`,
            };
        }

        return { status: "ready", kind: "dll", dllEntry: actualName, buffer };
    }

    if (asset.kind !== "zip") {
        return {
            status: "unsupported_artifact_kind",
            kind: asset.kind,
            summary: `Unsupported Community Mod artifact kind: ${asset.kind ?? "unknown"}.`,
        };
    }

    try {
        const entries = readCommunityModZipEntries(buffer);
        const unsafeEntries = entries.filter((entry) => isUnsafeZipEntry(entry)).map((entry) => entry.name);
        if (unsafeEntries.length > 0) {
            return {
                status: "unsafe_zip_entries",
                kind: "zip",
                summary: "Zip artifact contains unsafe entry paths.",
                unsafeEntries,
            };
        }

        const dllEntry = findExpectedDllEntry(entries, expectedDllName);
        if (!dllEntry) {
            return {
                status: "missing_expected_dll",
                kind: "zip",
                summary: `Zip artifact does not contain ${expectedDllName}.`,
            };
        }

        return {
            status: "ready",
            kind: "zip",
            dllEntry: dllEntry.name,
            buffer: extractZipEntry(buffer, dllEntry, { maxBytes: maxDllBytes }),
        };
    } catch (error) {
        return {
            status: "artifact_extraction_failed",
            kind: "zip",
            summary: error instanceof Error ? error.message : String(error),
        };
    }
}

function stagingResult(result) {
    return {
        ok: true,
        checkedAt: result.checkedAt,
        status: result.status,
        summary: result.summary,
        catalog: result.catalog ?? null,
        artifactVerification: result.artifactVerification ?? null,
        artifact: result.artifact ?? null,
        extraction: result.extraction ?? null,
        staged: result.staged ?? null,
        safety: {
            writesGameDirectory: false,
            writesSidecarCache: true,
            extractsOnlyExpectedDll: true,
            hashVerificationRequired: true,
        },
    };
}

function artifactStagePath(baseDir, catalog, asset) {
    const root = baseDir ? path.resolve(baseDir) : path.resolve(".sidecar", "mod-artifacts");
    return path.join(
        root,
        "staged",
        sanitizePathSegment(catalog.profile),
        sanitizePathSegment(catalog.release?.tagName ?? "release"),
        sanitizePathSegment(asset.expectedDllName ?? "version.dll"),
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