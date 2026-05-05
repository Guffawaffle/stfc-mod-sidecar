import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { verifyCommunityModArtifact } from "../../viewer/community-mod-artifact-verification.mjs";

const tempDirs = [];

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Community Mod artifact verification", () => {
    test("downloads, hashes, inspects, and caches a release zip", async () => {
        const zip = zipWithEntries(["version.dll", "README.txt"]);
        const cacheDir = await tempCacheDir();
        const result = await verifyCommunityModArtifact({
            checkedAt: "2026-05-04T00:00:00.000Z",
            cacheDir,
            catalog: readyCatalog({ digest: sha256Digest(zip), size: zip.length }),
            fetchImpl: fetchBuffer(zip),
        });

        expect(result).toMatchObject({
            status: "verified",
            cache: { reused: false, bytes: zip.length },
            artifact: {
                actualSha256: sha256Hex(zip),
                inspection: { status: "ready", dllEntry: "version.dll" },
            },
            safety: { writesGameDirectory: false },
        });
        expect(await readFile(result.cache.path)).toEqual(zip);
    });

    test("reuses a cached artifact when the hash already matches", async () => {
        const zip = zipWithEntries(["version.dll"]);
        const cacheDir = await tempCacheDir();
        const catalog = readyCatalog({ digest: sha256Digest(zip), size: zip.length });

        await verifyCommunityModArtifact({ cacheDir, catalog, fetchImpl: fetchBuffer(zip) });
        const result = await verifyCommunityModArtifact({
            cacheDir,
            catalog,
            fetchImpl: () => {
                throw new Error("fetch should not be called");
            },
        });

        expect(result).toMatchObject({ status: "verified", cache: { reused: true } });
    });

    test("rejects hash mismatches before caching", async () => {
        const zip = zipWithEntries(["version.dll"]);
        const result = await verifyCommunityModArtifact({
            cacheDir: await tempCacheDir(),
            catalog: readyCatalog({ digest: "sha256:0000", size: zip.length }),
            fetchImpl: fetchBuffer(zip),
        });

        expect(result).toMatchObject({
            status: "hash_mismatch",
            cache: null,
            artifact: { actualSha256: sha256Hex(zip), expectedSha256: "0000" },
        });
    });

    test("fails closed when trusted release digest metadata is missing", async () => {
        const zip = zipWithEntries(["version.dll"]);
        const result = await verifyCommunityModArtifact({
            cacheDir: await tempCacheDir(),
            catalog: readyCatalog({ digest: "", size: zip.length }),
            fetchImpl: () => {
                throw new Error("fetch should not be called without a trusted digest");
            },
        });

        expect(result).toMatchObject({
            status: "trusted_digest_required",
            cache: null,
            artifact: { expectedSha256: "" },
        });
    });

    test("rejects zips that do not contain version.dll", async () => {
        const zip = zipWithEntries(["notes.txt"]);
        const result = await verifyCommunityModArtifact({
            cacheDir: await tempCacheDir(),
            catalog: readyCatalog({ digest: sha256Digest(zip), size: zip.length }),
            fetchImpl: fetchBuffer(zip),
        });

        expect(result).toMatchObject({
            status: "missing_expected_dll",
            cache: null,
        });
    });

    test("rejects unsafe zip entry paths", async () => {
        const zip = zipWithEntries(["version.dll", "../escape.dll"]);
        const result = await verifyCommunityModArtifact({
            cacheDir: await tempCacheDir(),
            catalog: readyCatalog({ digest: sha256Digest(zip), size: zip.length }),
            fetchImpl: fetchBuffer(zip),
        });

        expect(result).toMatchObject({
            status: "unsafe_zip_entries",
            cache: null,
            artifact: { inspection: { unsafeEntries: ["../escape.dll"] } },
        });
    });

    test("does not fetch unsupported profile artifacts", async () => {
        const result = await verifyCommunityModArtifact({
            cacheDir: await tempCacheDir(),
            catalog: readyCatalog({ profile: "guff-advanced", installSupported: false }),
            fetchImpl: () => {
                throw new Error("fetch should not be called");
            },
        });

        expect(result).toMatchObject({ status: "profile_unsupported", cache: null });
    });
});

async function tempCacheDir() {
    const directory = await mkdtemp(path.join(tmpdir(), "stfc-sidecar-artifact-test-"));
    tempDirs.push(directory);
    return directory;
}

function readyCatalog(options = {}) {
    const digest = options.digest ?? "sha256:unused";
    return {
        ok: true,
        profile: options.profile ?? "netniv-basic",
        distribution: "official-basic",
        repository: "netniV/stfc-mod",
        status: "ready",
        installSupported: options.installSupported ?? true,
        unsupportedReason: options.unsupportedReason ?? "",
        release: {
            tagName: "v1.1.0",
            version: "1.1.0",
            htmlUrl: "https://github.com/netniV/stfc-mod/releases/tag/v1.1.0",
        },
        windowsAsset: {
            kind: "zip",
            name: "stfc-community-mod-v1.1.0.zip",
            size: options.size ?? 128,
            digest,
            browserDownloadUrl:
                "https://github.com/netniV/stfc-mod/releases/download/v1.1.0/stfc-community-mod-v1.1.0.zip",
            expectedDllName: "version.dll",
        },
    };
}

function fetchBuffer(buffer) {
    return async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-length", String(buffer.length)]]),
        arrayBuffer: async () => buffer,
    });
}

function zipWithEntries(entryNames) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (const entryName of entryNames) {
        const name = Buffer.from(entryName, "utf8");
        const localHeader = Buffer.alloc(30 + name.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(name.length, 26);
        name.copy(localHeader, 30);
        localParts.push(localHeader);

        const centralHeader = Buffer.alloc(46 + name.length);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(name.length, 28);
        centralHeader.writeUInt32LE(localOffset, 42);
        name.copy(centralHeader, 46);
        centralParts.push(centralHeader);
        localOffset += localHeader.length;
    }

    const localData = Buffer.concat(localParts);
    const centralDirectory = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entryNames.length, 8);
    eocd.writeUInt16LE(entryNames.length, 10);
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