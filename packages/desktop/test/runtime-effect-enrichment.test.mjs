import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildBattleDetailSnapshot } from "../../viewer/server/battle-log-access.mjs";
import {
    buildRuntimeEffectNameCatalog,
    getRuntimeEffectNameCatalog,
    resetRuntimeEffectNameCatalogForTests,
} from "../../viewer/server/runtime-effect-name-catalog.mjs";
import { buildResolvedRuntimeEffectOverlay } from "../../viewer/server/runtime-effect-enrichment.mjs";

describe("runtime effect enrichment", () => {
    test("resolves an officer below-decks ability relation by exact string IDs", () => {
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([
                {
                    sourceRef: "4290764940",
                    effectRef: "1120204726",
                    value: 0.7,
                    valueDisplay: "0.7",
                    phase: "post_attack",
                    markerKind: "triggered_effect_value",
                    triggered: true,
                    round: 2,
                    subRound: 2,
                    ownerShipId: "2724382960353887528",
                    ownerHullId: "311330874",
                },
            ]),
            catalogSnapshot({
                hulls: {
                    "311330874": { id: "311330874", name: "USS Northcutt", type: "Explorer", unresolved: false },
                },
                officers: {
                    "4290764940": {
                        id: "4290764940",
                        name: "Synthetic Officer",
                        unresolved: true,
                        locaKey: "50001",
                        belowDecksAbilityId: "1120204726",
                    },
                },
                abilities: {
                    "1120204726": {
                        id: "1120204726",
                        name: "Synthetic Ability",
                        unresolved: false,
                    },
                },
            }),
        );

        expect(overlay.coverage).toMatchObject({
            candidateCount: 1,
            structurallyResolvedCount: 1,
            unresolvedCount: 0,
            domainsResolved: ["officer"],
        });
        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            schema: "stfc.battle.resolved_runtime_effect.v0",
            sourceRef: "4290764940",
            sourceDomain: "officer",
            sourceName: "Synthetic Officer",
            sourceLocaKey: "50001",
            effectRef: "1120204726",
            effectSlot: "belowDecksAbilityId",
            effectName: "Synthetic Ability",
            valueDisplay: "0.7",
            phase: "post_attack",
            markerKind: "triggered_effect_value",
            triggered: true,
            round: 2,
            subRound: 2,
            ownerShipId: "2724382960353887528",
            ownerHullId: "311330874",
            ownerHullName: "USS Northcutt",
            confidence: "exact_catalog_field_match",
        });
    });

    test("resolves a captain maneuver officer relation", () => {
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([{ sourceRef: "2241990218", effectRef: "3308805436", valueDisplay: "1" }]),
            catalogSnapshot({
                officers: {
                    "2241990218": {
                        id: "2241990218",
                        unresolved: true,
                        captainManeuverId: "3308805436",
                        officerAbilityId: "1761806598",
                    },
                },
            }),
        );

        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceDomain: "officer",
            effectSlot: "captainManeuverId",
            confidence: "exact_catalog_field_match",
        });
    });

    test("falls back to display-like catalog fields when canonical name is absent", () => {
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([{ sourceRef: "123", effectRef: "456", valueDisplay: "1" }]),
            catalogSnapshot({
                officers: {
                    "123": {
                        id: "123",
                        displayName: "Display Officer",
                        captainManeuverId: "456",
                        unresolved: false,
                    },
                },
                abilities: {
                    "456": {
                        id: "456",
                        locaText: "Display Effect",
                        unresolved: false,
                    },
                },
            }),
        );

        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceName: "Display Officer",
            effectName: "Display Effect",
            sourceNameResolution: "catalog",
            effectNameResolution: "catalog",
            effectSlot: "captainManeuverId",
        });
    });

    test("hydrates names from a local snapshot seam when battle catalog only has sparse refs", () => {
        const nameCatalog = buildRuntimeEffectNameCatalog({
            officerSummary: [{
                id: 4290764940,
                game_id: 4290764940,
                loca_id: 50001,
                below_decks_ability: { id: 1120204726, loca_id: 50002 },
            }],
            officerNames: [
                { id: 50001, key: "officer_name", text: "Hugh" },
            ],
            officerBuffs: [
                { id: 50002, key: "officer_ability_name", text: "Resist and Retaliate" },
            ],
        });
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([{ sourceRef: "4290764940", effectRef: "1120204726", valueDisplay: "0.7" }]),
            catalogSnapshot({
                officers: {
                    "4290764940": {
                        id: "4290764940",
                        unresolved: true,
                        locaKey: "50001",
                        belowDecksAbilityId: "1120204726",
                    },
                },
            }),
            { nameCatalog },
        );

        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceName: "Hugh",
            sourceNameResolution: "local_snapshot",
            effectName: "Resist and Retaliate",
            effectNameResolution: "local_snapshot",
            effectSlot: "belowDecksAbilityId",
        });
        expect(overlay.resolvedRuntimeEffects[0].sourceNameSource).toContain("officer_names");
        expect(overlay.resolvedRuntimeEffects[0].effectNameSource).toContain("officer_buffs");
    });

    test("keeps exact refs and marks fallback when no names are available", () => {
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([{ sourceRef: "4290764940", effectRef: "1120204726", valueDisplay: "0.7" }]),
            catalogSnapshot({
                officers: {
                    "4290764940": {
                        id: "4290764940",
                        unresolved: true,
                        locaKey: "50001",
                        belowDecksAbilityId: "1120204726",
                    },
                },
            }),
            { nameCatalog: buildRuntimeEffectNameCatalog({}) },
        );

        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceRef: "4290764940",
            effectRef: "1120204726",
            sourceName: null,
            effectName: null,
            sourceNameResolution: "fallback_ref",
            effectNameResolution: "fallback_ref",
        });
    });

    test("loads a local snapshot from STFC_LOCAL_NAME_SNAPSHOT_DIR when configured", () => {
        const root = mkdtempSync(path.join(tmpdir(), "stfc-name-snapshot-"));
        try {
            writeSnapshotFixture(root);
            resetRuntimeEffectNameCatalogForTests();
            const nameCatalog = getRuntimeEffectNameCatalog({
                env: { STFC_LOCAL_NAME_SNAPSHOT_DIR: root },
                fallbackRoots: [],
            });
            const overlay = buildResolvedRuntimeEffectOverlay(
                analyticsEvent([{ sourceRef: "4290764940", effectRef: "1120204726", valueDisplay: "0.7" }]),
                catalogSnapshot({
                    officers: {
                        "4290764940": {
                            id: "4290764940",
                            unresolved: true,
                            locaKey: "50001",
                            belowDecksAbilityId: "1120204726",
                        },
                    },
                }),
                { nameCatalog },
            );

            expect(overlay.nameHydration).toMatchObject({
                status: "loaded",
                sourceLabel: "local_snapshot",
                configuredPath: root,
                configuredFrom: "STFC_LOCAL_NAME_SNAPSHOT_DIR",
                rootPath: root,
                snapshotVersion: "snapshot-test-v1",
                availableFiles: {
                    officerSummary: true,
                    officerNames: true,
                    officerBuffs: true,
                    forbiddenTech: false,
                    chaosTech: false,
                    buffDebuffCatalog: false,
                },
            });
            expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
                sourceName: "Hugh",
                effectName: "Resist and Retaliate",
                sourceNameResolution: "local_snapshot",
                effectNameResolution: "local_snapshot",
            });
        } finally {
            resetRuntimeEffectNameCatalogForTests();
            rmSync(root, { recursive: true, force: true });
        }
    });

    test("classifies a hull self-match without treating it as an officer", () => {
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([{ sourceRef: "311330874", effectRef: "311330874", valueDisplay: "1" }]),
            catalogSnapshot({
                hulls: {
                    "311330874": { id: "311330874", name: "USS Northcutt", type: "Explorer", unresolved: false },
                },
            }),
        );

        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceDomain: "hull",
            sourceName: "USS Northcutt",
            effectSlot: "hull_or_ship_effect",
            effectDomain: "hull",
            confidence: "exact_catalog_field_match",
        });
        expect(overlay.resolvedRuntimeEffects[0].sourceDomain).not.toBe("officer");
    });

    test("leaves an unmatched candidate unresolved", () => {
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([{ sourceRef: "999", effectRef: "888", valueDisplay: "0.25" }]),
            catalogSnapshot({ officers: {} }),
        );

        expect(overlay.coverage).toMatchObject({
            candidateCount: 1,
            structurallyResolvedCount: 0,
            unresolvedCount: 1,
            unresolvedRefs: ["888", "999"],
        });
        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceDomain: null,
            effectSlot: null,
            confidence: "unresolved",
        });
    });

    test("matches large IDs as strings without numeric coercion", () => {
        const sourceRef = "9007199254740993123";
        const effectRef = "9007199254740993987";
        const overlay = buildResolvedRuntimeEffectOverlay(
            analyticsEvent([{ sourceRef, effectRef, valueDisplay: "2" }]),
            catalogSnapshot({
                officers: {
                    [sourceRef]: { id: sourceRef, unresolved: true, officerAbilityId: effectRef },
                },
            }),
        );

        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceRef,
            effectRef,
            effectSlot: "officerAbilityId",
            confidence: "exact_catalog_field_match",
        });
    });

    test("builds overlay fields without mutating the original analytics event", () => {
        const analytics = analyticsEvent([{ sourceRef: "4290764940", effectRef: "1120204726", valueDisplay: "0.7" }]);
        const before = structuredClone(analytics);
        const overlay = buildResolvedRuntimeEffectOverlay(
            analytics,
            catalogSnapshot({
                officers: {
                    "4290764940": {
                        id: "4290764940",
                        unresolved: true,
                        belowDecksAbilityId: "1120204726",
                    },
                },
            }),
        );

        expect(analytics).toEqual(before);
        expect(analytics.analytics).not.toHaveProperty("resolvedRuntimeEffects");
        expect(overlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceRef: "4290764940",
            effectSlot: "belowDecksAbilityId",
        });
        expect(overlay.coverage.structurallyResolvedCount).toBe(1);
    });

    test("battle detail API exposes the overlay under derivedViews without changing raw analytics", () => {
        const detail = buildBattleDetailSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            events: [
                eventEntry(1, catalogSnapshot({
                    officers: {
                        "4290764940": {
                            id: "4290764940",
                            unresolved: true,
                            belowDecksAbilityId: "1120204726",
                        },
                    },
                })),
                eventEntry(2, analyticsEvent([{ sourceRef: "4290764940", effectRef: "1120204726", valueDisplay: "0.7" }])),
            ],
        }, "battle-1");

        expect(detail).not.toHaveProperty("runtimeEffectOverlay");
        expect(detail.derivedViews.runtimeEffectOverlay.coverage.structurallyResolvedCount).toBe(1);
        expect(detail.derivedViews.runtimeEffectOverlay.resolvedRuntimeEffects[0]).toMatchObject({
            sourceRef: "4290764940",
            effectSlot: "belowDecksAbilityId",
        });
        expect(detail.events[1].event.analytics).not.toHaveProperty("resolvedRuntimeEffects");
        expect(detail.events[1].event.analytics).not.toHaveProperty("resolvedRuntimeEffectSummary");
        expect(detail.events[1].event.analytics).not.toHaveProperty("resolvedRuntimeEffectCoverage");
    });
});

function analyticsEvent(candidates) {
    return {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "battle.analytics",
        schemaVersion: "stfc.battle.analytics.v0",
        timestamp: "2026-06-04T20:00:03.000Z",
        journalId: "journal-1",
        battleId: "battle-1",
        battleType: 8,
        analytics: {
            experimental: {
                runtimeAbilityCandidateCount: candidates.length,
                runtimeAbilityRowCandidates: candidates,
                resolver: {
                    status: "scan_only",
                    coverage: { refsScanned: 35, refsWithCandidateMatches: 0 },
                },
            },
            csvParity: {
                coverage: { abilityRowCount: 0 },
            },
        },
    };
}

function catalogSnapshot(domains) {
    return {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "catalog.snapshot",
        schemaVersion: "stfc.catalog.snapshot.v0",
        timestamp: "2026-06-04T20:00:02.000Z",
        journalId: "journal-1",
        battleId: "battle-1",
        battleType: 8,
        scope: "battle",
        catalog: {
            domains,
            coverage: {
                domainsPresent: Object.keys(domains),
                domainsResolved: [],
                domainsUnresolved: [],
                totalEntries: Object.values(domains).reduce((count, bucket) => count + Object.keys(bucket).length, 0),
                resolvedEntries: 0,
            },
        },
    };
}

function eventEntry(lineNumber, event) {
    return {
        parsed: true,
        lineNumber,
        event,
        eventType: event.type,
        battleId: event.battleId,
        journalId: event.journalId,
        battleType: event.battleType,
        timestamp: event.timestamp,
        summary: { title: event.type, timestamp: event.timestamp, chips: [event.type] },
    };
}

function writeSnapshotFixture(rootPath) {
    mkdirSync(path.join(rootPath, "officer"), { recursive: true });
    mkdirSync(path.join(rootPath, "translations", "en"), { recursive: true });
    writeFileSync(path.join(rootPath, "officer", "summary.json"), JSON.stringify([
        {
            id: 4290764940,
            game_id: 4290764940,
            loca_id: 50001,
            below_decks_ability: { id: 1120204726, loca_id: 50002 },
        },
    ]));
    writeFileSync(path.join(rootPath, "translations", "en", "officer_names.json"), JSON.stringify([
        { id: 50001, key: "officer_name", text: "Hugh" },
    ]));
    writeFileSync(path.join(rootPath, "translations", "en", "officer_buffs.json"), JSON.stringify([
        { id: 50002, key: "officer_ability_name", text: "Resist and Retaliate" },
    ]));
    writeFileSync(path.join(rootPath, "version.txt"), "snapshot-test-v1\n");
}
