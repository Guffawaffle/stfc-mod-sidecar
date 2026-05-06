import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { buildCommunityModInstallPlatformCapability } from "./community-mod-install-platform.mjs";
import { communityModProfileFromDistribution } from "./community-mod-profiles.mjs";

export const COMMUNITY_MOD_DLL_FILE = "version.dll";
export const COMMUNITY_MOD_MANIFEST_DIRECTORY = ".stfc-sidecar";
export const COMMUNITY_MOD_INSTALL_MANIFEST_FILE = "community-mod-install.json";

export const DEFAULT_COMMUNITY_MOD_RELEASE_FINGERPRINTS = Object.freeze([
    Object.freeze({
        profile: "netniv-basic",
        distribution: "official-basic",
        owner: "netniV",
        repo: "stfc-mod",
        tag: "v1.1.0",
        assetName: "stfc-community-mod-v1.1.0.zip",
        dllSha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA",
    }),
]);

export async function detectCommunityModInstall(gameDirectory, options = {}) {
    const generatedAt = options.generatedAt ?? new Date().toISOString();
    const platform = options.platformCapability ?? buildCommunityModInstallPlatformCapability({ platform: options.platform });
    const normalizedGameDirectory = typeof gameDirectory === "string" ? gameDirectory.trim() : "";
    if (!normalizedGameDirectory) {
        return {
            ok: true,
            state: "unselected",
            classification: "none",
            profile: "none",
            platform,
            generatedAt,
        };
    }

    const resolvedGameDirectory = await realpath(normalizedGameDirectory).catch(() => path.resolve(normalizedGameDirectory));
    if (!platform.installPlanningSupported) {
        return {
            ok: true,
            state: "unsupported_platform",
            classification: "none",
            profile: "none",
            gameDirectory: resolvedGameDirectory,
            platform,
            summary: platform.unsupportedReason,
            generatedAt,
        };
    }

    const dllPath = path.join(resolvedGameDirectory, COMMUNITY_MOD_DLL_FILE);
    const manifestPath = communityModInstallManifestPath(resolvedGameDirectory);
    const manifest = await readCommunityModInstallManifest(manifestPath);

    if (!(await fileExists(dllPath))) {
        return {
            ok: true,
            state: "none",
            classification: "none",
            profile: "none",
            gameDirectory: resolvedGameDirectory,
            dll: {
                exists: false,
                path: dllPath,
            },
            manifest,
            generatedAt,
        };
    }

    const [dllStat, dllSha256, versionInfo] = await Promise.all([
        stat(dllPath),
        sha256File(dllPath),
        readVersionInfo(dllPath, options),
    ]);
    const matchedRelease = findReleaseFingerprint(dllSha256, options.releaseFingerprints ?? DEFAULT_COMMUNITY_MOD_RELEASE_FINGERPRINTS);
    const manifestProfile = profileFromManifest(manifest, dllSha256);
    const classification = manifestProfile ?? matchedRelease?.profile ?? "unknown";

    return {
        ok: true,
        state: "installed",
        classification,
        profile: classification,
        gameDirectory: resolvedGameDirectory,
        dll: {
            exists: true,
            path: dllPath,
            size: dllStat.size,
            modifiedAt: dllStat.mtime.toISOString(),
            sha256: dllSha256,
            versionInfo,
        },
        manifest,
        matchedRelease: matchedRelease ?? null,
        generatedAt,
    };
}

export function communityModInstallManifestPath(gameDirectory) {
    return path.join(gameDirectory, COMMUNITY_MOD_MANIFEST_DIRECTORY, COMMUNITY_MOD_INSTALL_MANIFEST_FILE);
}

export async function readCommunityModInstallManifest(manifestPath) {
    if (!(await fileExists(manifestPath))) {
        return {
            exists: false,
            path: manifestPath,
        };
    }

    try {
        const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
        const manifest = isRecord(parsed) ? parsed : {};
        const dllSha256 = normalizeSha256(manifest.dllSha256);
        return {
            exists: true,
            path: manifestPath,
            schemaVersion: Number.isInteger(manifest.schemaVersion) ? manifest.schemaVersion : null,
            distribution: typeof manifest.distribution === "string" ? manifest.distribution : "",
            profile: profileFromDistribution(manifest.distribution),
            action: typeof manifest.action === "string" ? manifest.action : "",
            repo: typeof manifest.repo === "string" ? manifest.repo : "",
            tag: typeof manifest.tag === "string" ? manifest.tag : "",
            assetName: typeof manifest.assetName === "string" ? manifest.assetName : "",
            dllSha256,
            destinationPath: typeof manifest.destinationPath === "string" ? manifest.destinationPath : "",
            manifestPath: typeof manifest.manifestPath === "string" ? manifest.manifestPath : "",
            backup: normalizeManifestBackup(manifest.backup),
            previous: normalizeManifestPrevious(manifest.previous),
            sidecarVersion: typeof manifest.sidecarVersion === "string" ? manifest.sidecarVersion : "",
            installedAt: typeof manifest.installedAt === "string" ? manifest.installedAt : "",
        };
    } catch (error) {
        return {
            exists: true,
            path: manifestPath,
            parseError: error instanceof Error ? error.message : String(error),
        };
    }
}

export function findReleaseFingerprint(dllSha256, releaseFingerprints) {
    const normalized = normalizeSha256(dllSha256);
    return (releaseFingerprints ?? [])
        .map((fingerprint) => normalizeReleaseFingerprint(fingerprint))
        .find((fingerprint) => fingerprint.dllSha256 === normalized) ?? null;
}

export function profileFromDistribution(value) {
    return communityModProfileFromDistribution(value);
}

export async function readWindowsVersionInfo(filePath) {
    if (process.platform !== "win32") {
        return null;
    }

    const literalPath = escapePowerShellSingleQuotedString(filePath);
    const command = `
$item = Get-Item -LiteralPath '${literalPath}'
[pscustomobject]@{
  fileVersion = $item.VersionInfo.FileVersion
  productVersion = $item.VersionInfo.ProductVersion
  productName = $item.VersionInfo.ProductName
  originalFilename = $item.VersionInfo.OriginalFilename
} | ConvertTo-Json -Compress
`.trim();
    const output = await runPowerShell(command).catch(() => "");
    if (!output.trim()) {
        return null;
    }

    try {
        const parsed = JSON.parse(output);
        return {
            fileVersion: stringOrEmpty(parsed.fileVersion),
            productVersion: stringOrEmpty(parsed.productVersion),
            productName: stringOrEmpty(parsed.productName),
            originalFilename: stringOrEmpty(parsed.originalFilename),
        };
    } catch {
        return null;
    }
}

async function readVersionInfo(filePath, options) {
    if (typeof options.readVersionInfo === "function") {
        return options.readVersionInfo(filePath);
    }

    return readWindowsVersionInfo(filePath);
}

function profileFromManifest(manifest, dllSha256) {
    if (!manifest?.exists || manifest.parseError || !manifest.dllSha256 || manifest.dllSha256 !== normalizeSha256(dllSha256)) {
        return null;
    }

    return manifest.profile;
}

function normalizeReleaseFingerprint(fingerprint) {
    return {
        profile: profileFromDistribution(fingerprint.profile ?? fingerprint.distribution) ?? "unknown",
        distribution: typeof fingerprint.distribution === "string" ? fingerprint.distribution : "",
        owner: typeof fingerprint.owner === "string" ? fingerprint.owner : "",
        repo: typeof fingerprint.repo === "string" ? fingerprint.repo : "",
        tag: typeof fingerprint.tag === "string" ? fingerprint.tag : "",
        assetName: typeof fingerprint.assetName === "string" ? fingerprint.assetName : "",
        dllSha256: normalizeSha256(fingerprint.dllSha256),
    };
}

async function sha256File(filePath) {
    const hash = createHash("sha256");
    hash.update(await readFile(filePath));
    return hash.digest("hex").toUpperCase();
}

async function fileExists(filePath) {
    try {
        await access(filePath, fsConstants.F_OK);
        return true;
    } catch {
        return false;
    }
}

function normalizeManifestBackup(value) {
    const backup = isRecord(value) ? value : {};
    return {
        required: backup.required === true,
        created: backup.created === true,
        path: typeof backup.path === "string" ? backup.path : "",
        sha256: normalizeSha256(backup.sha256),
    };
}

function normalizeManifestPrevious(value) {
    const previous = isRecord(value) ? value : {};
    return {
        classification: typeof previous.classification === "string" ? previous.classification : "",
        profile: typeof previous.profile === "string" ? previous.profile : "",
        dllSha256: normalizeSha256(previous.dllSha256),
        tag: typeof previous.tag === "string" ? previous.tag : "",
        assetName: typeof previous.assetName === "string" ? previous.assetName : "",
    };
}

function normalizeSha256(value) {
    return String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
}

function runPowerShell(command, args = []) {
    return new Promise((resolve, reject) => {
        const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command, ...args], {
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
            }
        });
    });
}

function escapePowerShellSingleQuotedString(value) {
    return String(value ?? "").replaceAll("'", "''");
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrEmpty(value) {
    return typeof value === "string" ? value : "";
}