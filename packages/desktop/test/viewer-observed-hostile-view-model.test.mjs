import { describe, expect, test } from "vitest";

import {
    classifyObservedHostilePayload,
    describeObservedHostileIdentityQuality,
    describeObservedHostileSource,
    filterObservedHostileEntries,
    formatObservedHostileList,
} from "../../viewer/public/diagnostics/observed-hostiles/view-model.js";

describe("viewer observed hostile view model", () => {
    test("classifies observed hostile payload states", () => {
        expect(classifyObservedHostilePayload(null)).toBe("unavailable");
        expect(classifyObservedHostilePayload({ ok: false })).toBe("unavailable");
        expect(classifyObservedHostilePayload({ ok: true, entries: [] })).toBe("empty");
        expect(classifyObservedHostilePayload({ ok: true, entries: [{ key: "hull:1" }] })).toBe("entries");
    });

    test("filters catalog entries across grouped identity and latest observation fields", () => {
        const entries = [
            {
                key: "hull:3066099110",
                title: "Armada Carrier",
                identityKind: "hull_id",
                identityQuality: "coarse_shared",
                strongestConfidence: "strong",
                sourceSurfaces: ["prescan_target_widget"],
                hullIds: ["3066099110"],
                hullNames: ["Armada Carrier"],
                runtimeFleetIds: ["4001"],
                locationTranslationIds: [],
                userIds: [],
                latestObservation: { sourceSurface: "prescan_target_widget", runtimeFleetId: "4001" },
            },
            {
                key: "user:mar_special",
                title: "mar_special",
                identityKind: "user_id",
                identityQuality: "candidate_game_identity",
                strongestConfidence: "candidate",
                sourceSurfaces: ["navigation_interaction"],
                hullIds: [],
                hullNames: [],
                runtimeFleetIds: ["5002"],
                locationTranslationIds: ["847108551"],
                userIds: ["mar_special"],
                latestObservation: { sourceSurface: "navigation_interaction", locationTranslationId: "847108551" },
            },
        ];

        expect(filterObservedHostileEntries(entries, "carrier")).toEqual([entries[0]]);
        expect(filterObservedHostileEntries(entries, "847108551")).toEqual([entries[1]]);
        expect(filterObservedHostileEntries(entries, "prescan")).toEqual([entries[0]]);
        expect(filterObservedHostileEntries(entries, "")).toEqual(entries);
    });

    test("describes sidecar store backends and identity quality plainly", () => {
        expect(describeObservedHostileSource({ source: "store", storageBackend: "sqlite" })).toMatchObject({
            label: "Store (SQLite)",
        });
        expect(describeObservedHostileSource({ source: "store", storageBackend: "postgres" })).toMatchObject({
            label: "Store (PostgreSQL)",
        });
        expect(describeObservedHostileIdentityQuality("candidate_game_identity")).toContain("Candidate game identity");
        expect(describeObservedHostileIdentityQuality("process_local")).toContain("Process-local pointer");
    });

    test("formats grouped list summaries without overexpanding long sets", () => {
        expect(formatObservedHostileList([], { fallback: "None" })).toBe("None");
        expect(formatObservedHostileList(["one", "two"])).toBe("one, two");
        expect(formatObservedHostileList(["one", "two", "three"], { limit: 2 })).toBe("one, two +1");
    });
});
