import path from "node:path";

import { describe, expect, test } from "vitest";

import {
    buildCompanionAppUninstallStatus,
    companionUninstallerCandidates,
    isDirectChildPath,
    isPortableLaunch,
} from "../src/companion-uninstall.mjs";

describe("companion app uninstall status", () => {
    test("reports source/dev runs without an app uninstaller", () => {
        const status = buildCompanionAppUninstallStatus({
            platform: "win32",
            packaged: false,
            executablePath: "D:\\dev\\stfc-mod-sidecar\\node.exe",
        });

        expect(status).toMatchObject({
            mode: "source",
            canRunUninstaller: false,
            canOpenWindowsApps: true,
        });
    });

    test("reports portable packaged runs without a misleading app uninstall action", () => {
        const status = buildCompanionAppUninstallStatus({
            platform: "win32",
            packaged: true,
            executablePath: "C:\\Tools\\STFC Community Mod Companion-Portable-0.1.0-alpha.1-x64.exe",
            env: { PORTABLE_EXECUTABLE_DIR: "C:\\Tools" },
        });

        expect(status).toMatchObject({
            mode: "portable",
            canRunUninstaller: false,
            canOpenWindowsApps: true,
        });
    });

    test("detects an installed NSIS uninstaller beside the app executable", () => {
        const installDirectory = "C:\\Users\\Guff\\AppData\\Local\\Programs\\STFC Community Mod Companion";
        const uninstallerPath = path.join(installDirectory, "Uninstall STFC Community Mod Companion.exe");
        const status = buildCompanionAppUninstallStatus({
            platform: "win32",
            packaged: true,
            productName: "STFC Community Mod Companion",
            executablePath: path.join(installDirectory, "STFC Community Mod Companion.exe"),
            pathExists: (candidate) => candidate === uninstallerPath,
        });

        expect(status).toMatchObject({
            mode: "installed",
            canRunUninstaller: true,
            uninstallerPath,
            userDataPolicy: "preserve",
        });
    });

    test("keeps packaged copies with no uninstaller distinct from source and portable", () => {
        const status = buildCompanionAppUninstallStatus({
            platform: "win32",
            packaged: true,
            executablePath: "C:\\Program Files\\STFC Community Mod Companion\\STFC Community Mod Companion.exe",
            pathExists: () => false,
        });

        expect(status).toMatchObject({
            mode: "packaged_unknown",
            canRunUninstaller: false,
            warnings: ["Use Windows Apps & Features if this copy was installed."],
        });
    });

    test("builds stable candidate uninstaller names", () => {
        expect(companionUninstallerCandidates({
            installDirectory: "C:\\Apps\\Sidecar",
            productName: "STFC Community Mod Companion",
        })).toEqual([
            "C:\\Apps\\Sidecar\\Uninstall STFC Community Mod Companion.exe",
            "C:\\Apps\\Sidecar\\STFC Community Mod Companion Uninstaller.exe",
            "C:\\Apps\\Sidecar\\Uninstall.exe",
            "C:\\Apps\\Sidecar\\uninstall.exe",
        ]);
    });

    test("recognizes portable launch environment and direct child paths", () => {
        expect(isPortableLaunch({ PORTABLE_EXECUTABLE_FILE: "C:\\Tools\\sidecar.exe" })).toBe(true);
        expect(isDirectChildPath("C:\\Apps\\Sidecar", "C:\\Apps\\Sidecar\\Uninstall STFC Community Mod Companion.exe")).toBe(true);
        expect(isDirectChildPath("C:\\Apps\\Sidecar", "C:\\Apps\\Other\\Uninstall STFC Community Mod Companion.exe")).toBe(false);
    });
});