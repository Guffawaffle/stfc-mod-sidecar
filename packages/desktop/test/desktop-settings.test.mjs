import { describe, expect, test } from "vitest";

import { initialDeveloperModeFromSources, normalizeDesktopSettings, normalizeModProfile, parseDeveloperModeValue } from "../src/desktop-settings.mjs";

describe("desktop settings", () => {
    test("defaults to Standard Companion mode", () => {
        expect(normalizeDesktopSettings()).toEqual({
            gameDirectory: "",
            developerMode: false,
            modProfile: "netniv-basic",
        });
    });

    test("preserves a stored developer mode preference", () => {
        expect(normalizeDesktopSettings({ gameDirectory: "C:\\Games\\STFC", developerMode: true, modProfile: "netniv-basic" })).toEqual({
            gameDirectory: "C:\\Games\\STFC",
            developerMode: true,
            modProfile: "netniv-basic",
        });
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
        expect(normalizeModProfile("alpha")).toBe("guff-advanced");
        expect(normalizeModProfile("surprise")).toBe("netniv-basic");
    });
});