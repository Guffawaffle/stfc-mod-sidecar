import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
    assertDesktopPackagingPreflight,
    checkDesktopPackagingPreflight,
} from "../../../scripts/desktop-packaging-guard.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const desktopPackageJson = JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
const axSource = readFileSync(path.resolve(__dirname, "../../../scripts/ax.mjs"), "utf8");

describe("desktop packaging guard", () => {
    it("passes when no packaged desktop process is running from dist", () => {
        expect(checkDesktopPackagingPreflight({
            distDir: "D:/dev/stfc-mod-sidecar/packages/desktop/dist",
            runningProcesses: [],
        })).toMatchObject({ ok: true, runningProcesses: [] });
    });

    it("fails with a suggestive error when a packaged desktop process is running from dist", () => {
        expect(() => assertDesktopPackagingPreflight({
            distDir: "D:/dev/stfc-mod-sidecar/packages/desktop/dist",
            runningProcesses: [{
                pid: 4242,
                name: "STFC Community Mod Companion-Portable-0.1.0-rc.3-x64.exe",
                executablePath: "D:/dev/stfc-mod-sidecar/packages/desktop/dist/STFC Community Mod Companion-Portable-0.1.0-rc.3-x64.exe",
                commandLine: "",
            }],
        })).toThrow(/Close the running app and rerun the packaging command/i);
        expect(() => assertDesktopPackagingPreflight({
            distDir: "D:/dev/stfc-mod-sidecar/packages/desktop/dist",
            runningProcesses: [{
                pid: 4242,
                name: "STFC Community Mod Companion-Portable-0.1.0-rc.3-x64.exe",
                executablePath: "D:/dev/stfc-mod-sidecar/packages/desktop/dist/STFC Community Mod Companion-Portable-0.1.0-rc.3-x64.exe",
                commandLine: "",
            }],
        })).toThrow(/pid 4242/i);
    });

    it("wires the guard into direct desktop packaging scripts and ax packaging commands", () => {
        expect(desktopPackageJson.scripts.pack).toContain("desktop-packaging-guard.mjs");
        expect(desktopPackageJson.scripts["dist:win"]).toContain("desktop-packaging-guard.mjs");
        expect(axSource).toMatch(/ciCommand\([\s\S]*desktopDistPreflightStep\(\)[\s\S]*distWinStep\(\)/u);
        expect(axSource).toMatch(/distWinCommand\([\s\S]*desktopDistPreflightStep\(\)[\s\S]*distWinStep\(\)/u);
    });
});