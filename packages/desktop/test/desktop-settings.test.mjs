import { describe, expect, test } from "vitest";

import { initialDeveloperModeFromSources, normalizeDesktopSettings, normalizeModProfile, parseDeveloperModeValue } from "../src/desktop-settings.mjs";

describe("desktop settings", () => {
    test("defaults to Standard Companion mode", () => {
        expect(normalizeDesktopSettings()).toEqual({
            gameDirectory: "",
            developerMode: false,
            modProfile: "netniv-basic",
            profileGameDirectories: {},
        });
    });

    test("preserves a stored developer mode preference", () => {
        expect(normalizeDesktopSettings({ gameDirectory: "C:\\Games\\STFC", developerMode: true, modProfile: "netniv-basic" })).toEqual({
            gameDirectory: "C:\\Games\\STFC",
            developerMode: true,
            modProfile: "netniv-basic",
            profileGameDirectories: {
                "netniv-basic": "C:\\Games\\STFC",
            },
        });
    });

    test("uses the active profile directory from profile-scoped settings", () => {
        expect(normalizeDesktopSettings({
            modProfile: "guff-advanced",
            gameDirectory: "C:\\Games\\Official",
            profileGameDirectories: {
                "netniv-basic": "C:\\Games\\Official",
                "guff-advanced": "D:\\Games\\Guff",
            },
        })).toEqual({
            gameDirectory: "D:\\Games\\Guff",
            developerMode: false,
            modProfile: "waffle-advanced",
            profileGameDirectories: {
                "netniv-basic": "C:\\Games\\Official",
                "waffle-advanced": "D:\\Games\\Guff",
            },
        });
    });

    test("does not reuse another profile's directory when switching profiles", () => {
        expect(normalizeDesktopSettings({
            modProfile: "guff-advanced",
            profileGameDirectories: {
                "netniv-basic": "C:\\Games\\Official",
            },
        }).gameDirectory).toBe("");
    });

    test("uses the installer/bootstrap initial mode only when no setting is stored", () => {
        expect(normalizeDesktopSettings({}, { initialDeveloperMode: "enabled" }).developerMode).toBe(true);
        expect(normalizeDesktopSettings({ developerMode: false }, { initialDeveloperMode: "enabled" }).developerMode).toBe(false);
    });

    test("prefers explicit environment seed over installer resource seed", () => {
        expect(initialDeveloperModeFromSources({
            environmentValue: "0",
            seedSettings: { developerMode: true },
        })).toBe("0");
        expect(initialDeveloperModeFromSources({
            seedSettings: { developerMode: true },
        })).toBe(true);
    });

    test("parses common enabled values", () => {
        expect(parseDeveloperModeValue("1")).toBe(true);
        expect(parseDeveloperModeValue("developer")).toBe(true);
        expect(parseDeveloperModeValue("off")).toBe(false);
        expect(parseDeveloperModeValue(undefined)).toBe(false);
    });

    test("normalizes mod profile aliases", () => {
        expect(normalizeModProfile("official")).toBe("netniv-basic");
        expect(normalizeModProfile("waffle")).toBe("waffle-basic");
        expect(normalizeModProfile("alpha")).toBe("waffle-advanced");
        expect(normalizeModProfile("surprise")).toBe("netniv-basic");
    });
});