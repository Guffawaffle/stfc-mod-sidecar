import { describe, expect, test } from "vitest";

import {
    companionModeFromDeveloperMode,
    developerModeRequiredPayload,
    isDeveloperOnlyApiPath,
    isDeveloperOnlyPublicPath,
    parseDeveloperModeFlag,
} from "../../viewer/runtime-mode.mjs";

describe("runtime mode boundary", () => {
    test("defaults developer mode off", () => {
        expect(parseDeveloperModeFlag(undefined)).toBe(false);
        expect(companionModeFromDeveloperMode(false)).toBe("standard");
    });

    test("accepts explicit developer mode values", () => {
        expect(parseDeveloperModeFlag("true")).toBe(true);
        expect(parseDeveloperModeFlag("dev")).toBe(true);
        expect(companionModeFromDeveloperMode(true)).toBe("developer");
    });

    test("marks workbench public assets as developer-only", () => {
        expect(isDeveloperOnlyPublicPath("/battle-log/workbench/")).toBe(true);
        expect(isDeveloperOnlyPublicPath("/battle-log/workbench/app.js")).toBe(true);
        expect(isDeveloperOnlyPublicPath("/battle-log/")).toBe(false);
    });

    test("marks /api/dev routes as developer-only", () => {
        expect(isDeveloperOnlyApiPath("/api/dev/status")).toBe(true);
        expect(isDeveloperOnlyApiPath("/api/health")).toBe(false);
    });

    test("returns a stable denial payload", () => {
        expect(developerModeRequiredPayload()).toMatchObject({
            ok: false,
            code: "developer_mode_required",
            developerMode: false,
            companionMode: "standard",
        });
    });
});