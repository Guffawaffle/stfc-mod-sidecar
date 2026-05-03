import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { STFC_GAME_EXECUTABLE, validateStfcGameDirectory } from "../src/game-directory.mjs";

describe("validateStfcGameDirectory", () => {
    test("accepts a local directory containing prime.exe", async () => {
        const gameDirectory = await makeTempGameDirectory();
        await fs.writeFile(path.join(gameDirectory, STFC_GAME_EXECUTABLE), "");

        const result = await validateStfcGameDirectory(gameDirectory);

        expect(result.ok).toBe(true);
        expect(result.gameDirectory).toBe(await fs.realpath(gameDirectory));
        expect(path.basename(result.executablePath).toLowerCase()).toBe(STFC_GAME_EXECUTABLE);
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

    test("rejects relative paths before filesystem access", async () => {
        const result = await validateStfcGameDirectory(".");

        expect(result.ok).toBe(false);
        expect(result.code).toBe("relative_path");
    });
});

async function makeTempGameDirectory() {
    return fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-game-dir-"));
}