import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
    STFC_GAME_EXECUTABLE,
    STFC_GAME_REQUIRED_DIRECTORIES,
    STFC_GAME_REQUIRED_FILES,
    defaultStfcGameDirectoryCandidates,
    detectDefaultStfcGameDirectory,
    validateStfcGameDirectory,
} from "../src/game-directory.mjs";

describe("validateStfcGameDirectory", () => {
    test("accepts a local directory containing prime.exe", async () => {
        const gameDirectory = await makeTempGameDirectory();
        await fs.writeFile(path.join(gameDirectory, STFC_GAME_EXECUTABLE), "");

        const result = await validateStfcGameDirectory(gameDirectory);

        expect(result.ok).toBe(true);
        expect(result.gameDirectory).toBe(await fs.realpath(gameDirectory));
        expect(path.basename(result.executablePath).toLowerCase()).toBe(STFC_GAME_EXECUTABLE);
        expect(result.requiredFiles).toEqual(STFC_GAME_REQUIRED_FILES);
        expect(result.requiredDirectories).toEqual(STFC_GAME_REQUIRED_DIRECTORIES);
    });

    test("rejects a directory without prime.exe", async () => {
        const gameDirectory = await makeTempGameDirectory();

        const result = await validateStfcGameDirectory(gameDirectory);

        expect(result.ok).toBe(false);
        expect(result.code).toBe("missing_prime");
    });

    test("rejects prime.exe when it is only present below a nested directory", async () => {
        const gameDirectory = await makeTempGameDirectory();
        const nestedDirectory = path.join(gameDirectory, "nested");
        await fs.mkdir(nestedDirectory);
        await fs.writeFile(path.join(nestedDirectory, STFC_GAME_EXECUTABLE), "");

        const result = await validateStfcGameDirectory(gameDirectory);

        expect(result.ok).toBe(false);
        expect(result.code).toBe("missing_prime");
    });

    test("rejects a directory missing Unity IL2CPP anchors", async () => {
        const gameDirectory = await makeBareTempDirectory();
        await fs.writeFile(path.join(gameDirectory, STFC_GAME_EXECUTABLE), "");

        const result = await validateStfcGameDirectory(gameDirectory);

        expect(result.ok).toBe(false);
        expect(result.code).toBe("missing_stfc_file");
    });

    test("rejects relative paths before filesystem access", async () => {
        const result = await validateStfcGameDirectory(".");

        expect(result.ok).toBe(false);
        expect(result.code).toBe("relative_path");
    });

    test("builds default candidates with explicit env override first", () => {
        const env = {
            STFC_SIDECAR_GAME_DIR: path.join(os.tmpdir(), "stfc-explicit"),
            SystemDrive: "C:",
            ProgramFiles: "C:\\Program Files",
            "ProgramFiles(x86)": "C:\\Program Files (x86)",
        };

        const candidates = defaultStfcGameDirectoryCandidates(env);

        expect(candidates[0]).toBe(path.resolve(env.STFC_SIDECAR_GAME_DIR));
        expect(candidates).toContain(path.resolve("C:\\Games\\Star Trek Fleet Command\\default\\game"));
    });

    test("detects a validated environment game directory", async () => {
        const gameDirectory = await makeTempGameDirectory();
        await fs.writeFile(path.join(gameDirectory, STFC_GAME_EXECUTABLE), "");

        const result = await detectDefaultStfcGameDirectory({
            env: {
                STFC_SIDECAR_GAME_DIR: gameDirectory,
                SystemDrive: "Z:",
            },
        });

        expect(result.ok).toBe(true);
        expect(result.gameDirectory).toBe(await fs.realpath(gameDirectory));
        expect(result.detected).toBe(true);
    });
});

async function makeTempGameDirectory() {
    const gameDirectory = await makeBareTempDirectory();
    await fs.writeFile(path.join(gameDirectory, "GameAssembly.dll"), "");
    await fs.writeFile(path.join(gameDirectory, "UnityPlayer.dll"), "");
    await fs.mkdir(path.join(gameDirectory, "prime_Data"));
    return gameDirectory;
}

async function makeBareTempDirectory() {
    return fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-game-dir-"));
}