import { describe, expect, test } from "vitest";

import {
    formatLocalInstant,
    formatRecordInstant,
    normalizeUtcInstantString,
    pickBestInstant,
} from "../../viewer/public/shared/instant.js";

describe("viewer battle instant helpers", () => {
    test("treats bare ISO timestamps as UTC instants before local rendering", () => {
        expect(normalizeUtcInstantString("2026-06-06T01:26:54")).toBe("2026-06-06T01:26:54Z");
        expect(
            formatLocalInstant("2026-06-06T01:26:54", {
                locale: "en-US",
                timeZone: "America/Chicago",
            }),
        ).toBe("6/5/2026, 8:26:54 PM");
        expect(
            formatLocalInstant("2026-06-06T01:26:54Z", {
                locale: "en-US",
                timeZone: "America/Chicago",
            }),
        ).toBe("6/5/2026, 8:26:54 PM");
    });

    test("prefers capturedAtUnixMs over timestamp strings when both are present", () => {
        const capturedAtUnixMs = Date.parse("2026-06-06T01:26:54.000Z");
        const record = {
            capturedAtUnixMs,
            timestamp: "2026-06-06T01:26:54",
        };

        expect(pickBestInstant(record)).toBe(capturedAtUnixMs);
        expect(
            formatRecordInstant(record, {
                locale: "en-US",
                timeZone: "America/Chicago",
            }),
        ).toBe("6/5/2026, 8:26:54 PM");
    });

    test("falls back to nested capture.capturedAtUnixMs when needed", () => {
        const capturedAtUnixMs = Date.parse("2026-06-06T01:26:54.000Z");
        expect(pickBestInstant({
            capture: {
                capturedAtUnixMs,
            },
        })).toBe(capturedAtUnixMs);
    });
});
