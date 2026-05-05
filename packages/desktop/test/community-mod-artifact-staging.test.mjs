import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { stageCommunityModArtifact } from "../../viewer/community-mod-artifact-staging.mjs";

const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Community Mod artifact staging", () => {
    test("extracts only version.dll from a verified zip into sidecar cache", async () => {
        const dll = Buffer.from("official dll bytes");
        const zip = zipWithEntries([
            { name: "version.dll", data: dll },
            { name: "README.txt", data: Buffer.from("not staged") },
        ]);
        const cacheDir = await tempCacheDir();
        const cachePath = await cachedArtifact(cacheDir, zip);
        const result = await stageCommunityModArtifact({
            checkedAt: "2026-05-04T00:00:00.000Z",
            cacheDir,
            catalog: readyCatalog({ digest: sha256Digest(zip), size: zip.length }),
            verification: verifiedArtifact({ cachePath, bytes: zip.length }),
        });

        expect(result).toMatchObject({
            status: "staged",
            summary: "Community Mod version.dll staged in the sidecar cache.",
            extraction: { kind: "zip", dllEntry: "version.dll" },
            staged: {
                bytes: dll.length,
                dllSha256: sha256Hex(dll),
            },
            safety: {
                writesGameDirectory: false,
                writesSidecarCache: true,
                extractsOnlyExpectedDll: true,
            },
        });
        expect(await readFile(result.staged.path)).toEqual(dll);
        expect(result.staged.path).toContain(`${path.sep}staged${path.sep}netniv-basic${path.sep}v1.1.0${path.sep}`);
    });

    test("stages direct dll artifacts without zip extraction", async () => {
        const dll = Buffer.from("direct dll bytes");
        const cacheDir = await tempCacheDir();
        const cachePath = await cachedArtifact(cacheDir, dll);
        const result = await stageCommunityModArtifact({
            cacheDir,
            catalog: readyCatalog({ kind: "dll", name: "version.dll", digest: sha256Digest(dll), size: dll.length }),
            verification: verifiedArtifact({ cachePath, bytes: dll.length }),
        });

        expect(result).toMatchObject({
            status: "staged",
            extraction: { kind: "dll", dllEntry: "version.dll" },
            staged: { bytes: dll.length, dllSha256: sha256Hex(dll) },
        });
    });

    test("refuses staging when the artifact has not been verified", async () => {
        const result = await stageCommunityModArtifact({
            cacheDir: await tempCacheDir(),
            catalog: readyCatalog(),
            verification: { status: "hash_mismatch", summary: "Downloaded artifact SHA-256 did not match." },
        });

        expect(result).toMatchObject({
            status: "artifact_not_verified",
            staged: null,
            safety: { writesGameDirectory: false },
        });
    });

    test("rechecks cached artifact hashes before staging", async () => {
        const original = zipWithEntries([{ name: "version.dll", data: Buffer.from("original") }]);
        const tampered = zipWithEntries([{ name: "version.dll", data: Buffer.from("tampered") }]);
        const cacheDir = await tempCacheDir();
        const cachePath = await cachedArtifact(cacheDir, tampered);
        const result = await stageCommunityModArtifact({
            cacheDir,
            catalog: readyCatalog({ digest: sha256Digest(original), size: original.length }),
            verification: verifiedArtifact({ cachePath, bytes: tampered.length }),
        });

        expect(result).toMatchObject({
            status: "artifact_cache_mismatch",
            staged: null,
            artifact: {
                expectedSha256: sha256Hex(original),
                actualSha256: sha256Hex(tampered),
            },
        });
    });

    test("refuses staging when trusted release digest metadata is missing", async () => {
        const zip = zipWithEntries([{ name: "version.dll", data: Buffer.from("dll") }]);
        const cacheDir = await tempCacheDir();
        const cachePath = await cachedArtifact(cacheDir, zip);
        const result = await stageCommunityModArtifact({
            cacheDir,
            catalog: readyCatalog({ digest: "", size: zip.length }),
            verification: verifiedArtifact({ cachePath, bytes: zip.length }),
        });

        expect(result).toMatchObject({
            status: "trusted_digest_required",
            staged: null,
            artifact: { expectedSha256: "", actualSha256: "" },
        });
    });

    test("rejects unsafe zip entries even when staging is called directly", async () => {
        const zip = zipWithEntries([
            { name: "version.dll", data: Buffer.from("dll") },
            { name: "../escape.dll", data: Buffer.from("escape") },
        ]);
        const cacheDir = await tempCacheDir();
        const cachePath = await cachedArtifact(cacheDir, zip);
        const result = await stageCommunityModArtifact({
            cacheDir,
            catalog: readyCatalog({ digest: sha256Digest(zip), size: zip.length }),
            verification: verifiedArtifact({ cachePath, bytes: zip.length }),
        });

        expect(result).toMatchObject({
            status: "unsafe_zip_entries",
            staged: null,
            extraction: { unsafeEntries: ["../escape.dll"] },
        });
    });
});

async function tempCacheDir() {
    const directory = await mkdtemp(path.join(tmpdir(), "stfc-sidecar-staging-test-"));
    tempDirs.push(directory);
    return directory;
}

async function cachedArtifact(cacheDir, buffer) {
    const cachePath = path.join(cacheDir, "artifact.zip");
    await writeFile(cachePath, buffer);
    return cachePath;
}

function readyCatalog(options = {}) {
    const name = options.name ?? "stfc-community-mod-v1.1.0.zip";
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
            kind: options.kind ?? "zip",
            name,
            size: options.size ?? 128,
            digest: options.digest ?? "sha256:unused",
            browserDownloadUrl: `https://github.com/netniV/stfc-mod/releases/download/v1.1.0/${name}`,
            expectedDllName: "version.dll",
        },
    };
}

function verifiedArtifact(options = {}) {
    return {
        ok: true,
        status: "verified",
        cache: { path: options.cachePath, bytes: options.bytes ?? 128, reused: true },
        safety: { writesGameDirectory: false },
    };
}

function zipWithEntries(entries) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (const entry of entries) {
        const name = Buffer.from(entry.name, "utf8");
        const data = Buffer.from(entry.data ?? "");
        const localHeader = Buffer.alloc(30 + name.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 8);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(name.length, 26);
        name.copy(localHeader, 30);
        localParts.push(localHeader, data);

        const centralHeader = Buffer.alloc(46 + name.length);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(name.length, 28);
        centralHeader.writeUInt32LE(localOffset, 42);
        name.copy(centralHeader, 46);
        centralParts.push(centralHeader);
        localOffset += localHeader.length + data.length;
    }

    const localData = Buffer.concat(localParts);
    const centralDirectory = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirectory.length, 12);
    eocd.writeUInt32LE(localData.length, 16);
    return Buffer.concat([localData, centralDirectory, eocd]);
}

function sha256Hex(buffer) {
    return createHash("sha256").update(buffer).digest("hex").toUpperCase();
}

function sha256Digest(buffer) {
    return `sha256:${sha256Hex(buffer).toLowerCase()}`;
}