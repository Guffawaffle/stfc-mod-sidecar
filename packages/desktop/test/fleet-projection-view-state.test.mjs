import { describe, expect, test } from "vitest";

import { classifyProjectionPayload } from "../../viewer/public/fleet/projection-view-state.js";

describe("fleet projection view state", () => {
    test("treats unavailable broker payloads as unavailable", () => {
        expect(classifyProjectionPayload({
            ok: true,
            available: false,
            projection: null,
        })).toBe("unavailable");
    });

    test("treats empty projections as empty", () => {
        expect(classifyProjectionPayload({
            ok: true,
            available: true,
            projection: { slots: [] },
        })).toBe("empty");
    });

    test("treats populated projections as rows", () => {
        expect(classifyProjectionPayload({
            ok: true,
            available: true,
            projection: { slots: [{ fleetKey: "fleet-01" }] },
        })).toBe("rows");
    });
});