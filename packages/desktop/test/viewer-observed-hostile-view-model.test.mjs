import { describe, expect, test } from "vitest";

import {
    classifyObservedHostilePayload,
    describeObservedHostileBaseline,
    describeObservedHostileEvidenceTier,
    describeObservedHostileIdentityQuality,
    describeObservedHostileReferencePresence,
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
        expect(classifyObservedHostilePayload({ ok: true, items: [{ key: "hull:1" }] })).toBe("entries");
    });

    test("filters catalog entries across grouped identity and latest observation fields", () => {
        const entries = [
            {
                key: "hull:3066099110",
                title: "Armada Carrier",
                identityKind: "hull_id",
                identityQuality: "coarse_shared",
                referencePresence: "known",
                strongestConfidence: "strong",
                sourceSurfaces: ["prescan_target_widget"],
                hullIds: ["3066099110"],
                hullNames: ["Armada Carrier"],
                runtimeFleetIds: ["4001"],
                locationTranslationIds: [],
                userIds: [],
                systemIds: ["818257505"],
                userLevels: [39],
                userLocaIds: ["91903"],
                hullTypeNames: ["Destroyer"],
                fleetTypeNames: ["Marauder"],
                baseline: {
                    status: "matched",
                    summary: "Bundled hostile baseline found one high-confidence hostile candidate.",
                    matches: [{ hostileId: "320710612", name: "Romulan War Coalition", factionName: "Romulan" }],
                },
                latestObservation: { sourceSurface: "prescan_target_widget", runtimeFleetId: "4001", systemId: "818257505" },
            },
            {
                key: "user:mar_special",
                title: "mar_special",
                identityKind: "user_id",
                identityQuality: "candidate_game_identity",
                referencePresence: "unknown",
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
        expect(filterObservedHostileEntries(entries, "320710612")).toEqual([entries[0]]);
        expect(filterObservedHostileEntries(entries, "romulan war coalition")).toEqual([entries[0]]);
        expect(filterObservedHostileEntries(entries, "")).toEqual(entries);
    });

    test("describes sidecar store backends and identity quality plainly", () => {
        expect(describeObservedHostileSource({ source: "store", storageBackend: "sqlite" })).toMatchObject({
            label: "Store (SQLite)",
        });
        expect(describeObservedHostileSource({ source: "store", storageBackend: "postgres" })).toMatchObject({
            label: "Store (PostgreSQL)",
        });
        expect(describeObservedHostileEvidenceTier("tier1_passive_system_view")).toMatchObject({
            label: "Passive system view",
        });
        expect(describeObservedHostileEvidenceTier("tier2_view_adjacent_ui")).toMatchObject({
            label: "Supplemental UI",
        });
        expect(describeObservedHostileIdentityQuality("candidate_game_identity")).toContain("Candidate game identity");
        expect(describeObservedHostileIdentityQuality("process_local")).toContain("Process-local pointer");
        expect(describeObservedHostileReferencePresence("known")).toMatchObject({
            label: "Known by STFC.space",
        });
        expect(describeObservedHostileReferencePresence("unknown")).toMatchObject({
            label: "Gap Candidate",
        });
    });

    test("describes bundled baseline comparison states plainly", () => {
        expect(describeObservedHostileBaseline({ status: "matched" })).toMatchObject({
            label: "Baseline matched",
        });
        expect(describeObservedHostileBaseline({ status: "ambiguous" })).toMatchObject({
            label: "Baseline ambiguous",
        });
        expect(describeObservedHostileBaseline({ status: "unmapped" })).toMatchObject({
            label: "Baseline unmapped",
        });
    });

    test("formats grouped list summaries without overexpanding long sets", () => {
        expect(formatObservedHostileList([], { fallback: "None" })).toBe("None");
        expect(formatObservedHostileList(["one", "two"])).toBe("one, two");
        expect(formatObservedHostileList(["one", "two", "three"], { limit: 2 })).toBe("one, two +1");
    });
});
