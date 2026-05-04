import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
    COMMUNITY_MOD_DLL_FILE,
    communityModInstallManifestPath,
    detectCommunityModInstall,
    findReleaseFingerprint,
    profileFromDistribution,
} from "../../viewer/community-mod-install.mjs";

describe("community mod install detection", () => {
    test("reports no install when version.dll is missing", async () => {
        const gameDirectory = await makeTempGameDirectory();

        const result = await detectCommunityModInstall(gameDirectory, { generatedAt: "2026-05-03T00:00:00.000Z" });

        expect(result).toMatchObject({
            ok: true,
            state: "none",
            classification: "none",
            profile: "none",
            dll: { exists: false },
        });
    });

    test("reports unsupported platforms without probing Windows DLL paths", async () => {
        const gameDirectory = await makeTempGameDirectory();

        const result = await detectCommunityModInstall(gameDirectory, {
            platform: "darwin",
            generatedAt: "2026-05-04T00:00:00.000Z",
        });

        expect(result).toMatchObject({
            ok: true,
            state: "unsupported_platform",
            classification: "none",
            profile: "none",
            platform: {
                platform: "darwin",
                installPlanningSupported: false,
                installExecutionSupported: false,
            },
            summary: "macOS Community Mod install/update is not implemented yet.",
        });
    });

    test("matches known official Basic release fingerprints by DLL hash", async () => {
        const gameDirectory = await makeTempGameDirectory();
        const dllContents = Buffer.from("official netniv dll");
        await fs.writeFile(path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE), dllContents);
        const dllSha256 = sha256(dllContents);

        const result = await detectCommunityModInstall(gameDirectory, {
            generatedAt: "2026-05-03T00:00:00.000Z",
            releaseFingerprints: [{ distribution: "official-basic", tag: "v-test", dllSha256 }],
            readVersionInfo: async () => ({
                fileVersion: "1.1.0.0",
                productVersion: "1.1.0.0",
                productName: "STFC: Community Mod",
                originalFilename: "stfc-community-mod.dll",
            }),
        });

        expect(result).toMatchObject({
            ok: true,
            state: "installed",
            classification: "netniv-basic",
            profile: "netniv-basic",
            dll: {
                exists: true,
                sha256: dllSha256,
                versionInfo: {
                    fileVersion: "1.1.0.0",
                    originalFilename: "stfc-community-mod.dll",
                },
            },
            matchedRelease: {
                profile: "netniv-basic",
                tag: "v-test",
            },
        });
    });

    test("trusts a sidecar manifest only when the DLL hash still matches", async () => {
        const gameDirectory = await makeTempGameDirectory();
        const dllContents = Buffer.from("advanced alpha dll");
        await fs.writeFile(path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE), dllContents);
        await writeManifest(gameDirectory, {
            schemaVersion: 1,
            distribution: "advanced-alpha",
            repo: "Guffawaffle/stfc-mod",
            tag: "v-test-alpha",
            dllSha256: sha256(dllContents),
        });

        const result = await detectCommunityModInstall(gameDirectory, { releaseFingerprints: [], readVersionInfo: async () => null });

        expect(result).toMatchObject({
            classification: "guff-advanced",
            profile: "guff-advanced",
            manifest: {
                exists: true,
                profile: "guff-advanced",
                tag: "v-test-alpha",
            },
        });
    });

    test("falls back to unknown when an existing DLL is not matched safely", async () => {
        const gameDirectory = await makeTempGameDirectory();
        await fs.writeFile(path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE), "mystery dll");

        const result = await detectCommunityModInstall(gameDirectory, { releaseFingerprints: [], readVersionInfo: async () => null });

        expect(result).toMatchObject({
            state: "installed",
            classification: "unknown",
            profile: "unknown",
            matchedRelease: null,
        });
    });

    test("ignores stale manifests when the DLL hash changed", async () => {
        const gameDirectory = await makeTempGameDirectory();
        await fs.writeFile(path.join(gameDirectory, COMMUNITY_MOD_DLL_FILE), "current dll");
        await writeManifest(gameDirectory, {
            schemaVersion: 1,
            distribution: "official-basic",
            dllSha256: sha256(Buffer.from("old dll")),
        });

        const result = await detectCommunityModInstall(gameDirectory, { releaseFingerprints: [], readVersionInfo: async () => null });

        expect(result.classification).toBe("unknown");
        expect(result.manifest.profile).toBe("netniv-basic");
    });

    test("normalizes distribution aliases and release hashes", () => {
        expect(profileFromDistribution("official-basic")).toBe("netniv-basic");
        expect(profileFromDistribution("advanced-alpha")).toBe("guff-advanced");
        expect(profileFromDistribution("surprise")).toBeNull();
        expect(findReleaseFingerprint("sha256:ABC", [{ distribution: "official-basic", dllSha256: "abc" }])).toMatchObject({
            profile: "netniv-basic",
        });
    });
});

async function makeTempGameDirectory() {
    return fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-mod-install-"));
}

async function writeManifest(gameDirectory, manifest) {
    const manifestPath = communityModInstallManifestPath(gameDirectory);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function sha256(contents) {
    return createHash("sha256").update(contents).digest("hex").toUpperCase();
}