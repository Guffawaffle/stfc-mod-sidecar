import { describe, expect, test } from "vitest";

import { buildBattleExplanation } from "../../viewer/server/battle-explanation.mjs";
import { buildBattleDetailSnapshot } from "../../viewer/server/battle-log-access.mjs";

describe("battle explanation projection", () => {
    test("builds a stable human-readable battle explanation from analytics, catalog, and runtime overlay", () => {
        const analytics = analyticsEvent();
        const before = structuredClone(analytics);
        const explanation = buildBattleExplanation({
            battleId: "battle-1",
            reportEvent: reportEvent(),
            captureEvent: captureEvent(),
            analyticsEvent: analytics,
            catalogSnapshotEvent: catalogSnapshot(),
            runtimeEffectOverlay: runtimeEffectOverlay(),
        });

        expect(explanation.headline).toBe("USS Northcutt defeated Lv.60 L60 Exborg Explorer in 2 rounds.");
        expect(explanation.participants).toEqual([
            expect.objectContaining({
                side: "initiator",
                displayName: "Guffawaffle",
                shipLabel: "USS Northcutt",
                hullId: "311330874",
                hullType: "Destroyer",
            }),
            expect.objectContaining({
                side: "target",
                displayName: "Lv.60 L60 Exborg Explorer",
                shipLabel: "Lv.60 L60 Exborg Explorer",
                hullId: "2222222222",
                hullType: "Explorer",
            }),
        ]);
        expect(explanation.outcome).toEqual({
            winnerSide: "initiator",
            roundCount: 2,
            attackRowCount: 3,
        });
        expect(explanation.damageSummary.initiator).toMatchObject({
            hullDamageDisplay: "150",
            shieldDamageDisplay: "200",
            mitigatedDamageDisplay: "15",
            isolyticDamageDisplay: "200",
        });
        expect(explanation.damageSummary.target).toMatchObject({
            hullDamageDisplay: "25",
            shieldDamageDisplay: "10",
            mitigatedDamageDisplay: "2",
            isolyticDamageDisplay: "0",
        });
        expect(explanation.weaponSummary[0]).toMatchObject({
            ownerSide: "initiator",
            componentId: "812617665",
            componentName: "Weap Energy G5 Destroyer Fed Uncommon W1 T6",
            attackCount: 2,
            criticalCount: 2,
            hullDamageDisplay: "150",
            isolyticDamageDisplay: "200",
        });
        expect(explanation.runtimeEffects).toEqual([
            expect.objectContaining({
                label: "Borg Hugh below-decks Adaptive Analysis observed at 0.7",
                sourceLabel: "Borg Hugh",
                sourceDomain: "officer",
                sourceRef: "4290764940",
                sourceName: "Borg Hugh",
                sourceLocaKey: "50001",
                effectRef: "1120204726",
                effectSlot: "belowDecksAbilityId",
                effectName: "Adaptive Analysis",
                effectLabel: "Adaptive Analysis",
                valueDisplay: "0.7",
                triggeredCount: 1,
                observedCount: 2,
                phases: ["post_attack", "pre_attack"],
                confidence: "exact_catalog_field_match",
                humanClaim: "Observed as a structurally matched below-decks officer effect. Not yet promoted to final proc math.",
            }),
            expect.objectContaining({
                label: "Ref#999 runtime effect observed at 1",
                sourceLabel: "Ref#999",
                effectLabel: "effect#888",
                confidence: "unresolved",
                observedCount: 1,
            }),
        ]);
        expect(explanation.runtimeEffectsMeta).toMatchObject({
            structuralNote: "Runtime effects are observed candidate rows, not finalized proc-rate math.",
            structuralMatchCount: 2,
            candidateCount: 3,
            unresolvedCount: 1,
            nameHydration: {
                status: "unavailable",
                sourceLabel: "unavailable",
            },
        });
        expect(explanation.unresolved.runtimeEffectRefs).toEqual(["888", "999"]);
        expect(explanation.unresolved.catalogRefs).toEqual([]);
        expect(explanation.nonClaims).toContain("CSV ability rows remain unpromoted.");
        expect(analytics).toEqual(before);
    });

    test("battle detail exposes battleExplanation only as a derived view without replacing raw events", () => {
        const detail = buildBattleDetailSnapshot({
            ok: true,
            source: "store",
            storageBackend: "sqlite",
            events: [
                eventEntry(1, captureEvent()),
                eventEntry(2, reportEvent()),
                eventEntry(3, catalogSnapshot()),
                eventEntry(4, analyticsEvent()),
            ],
        }, "battle-1");

        expect(detail).not.toHaveProperty("battleExplanation");
        expect(detail.derivedViews.battleExplanation).toMatchObject({
            schema: "stfc.battle.explanation.v0",
            headline: "USS Northcutt defeated Lv.60 L60 Exborg Explorer in 2 rounds.",
        });
        expect(detail.events.map((entry) => entry.event.type)).toEqual([
            "battle.capture",
            "battle.report",
            "catalog.snapshot",
            "battle.analytics",
        ]);
        expect(detail.events[3].event.analytics).not.toHaveProperty("battleExplanation");
        expect(detail.events[3].event.analytics.csvParity.coverage.abilityRowCount).toBe(0);
    });

    test("uses an effect ref sentence when only the source name is resolved", () => {
        const explanation = buildBattleExplanation({
            battleId: "battle-1",
            runtimeEffectOverlay: {
                resolvedRuntimeEffects: [
                    {
                        sourceDomain: "officer",
                        sourceRef: "4290764940",
                        sourceName: "Hugh",
                        sourceNameResolution: "local_snapshot",
                        sourceNameSource: "local_snapshot:officer_names:50001",
                        sourceLocaKey: "50001",
                        effectRef: "1120204726",
                        effectSlot: "belowDecksAbilityId",
                        effectName: null,
                        effectNameResolution: "fallback_ref",
                        effectNameSource: null,
                        valueDisplay: "0.7",
                        phase: "post_attack",
                        triggered: true,
                        confidence: "exact_catalog_field_match",
                    },
                ],
                coverage: { unresolvedRefs: [] },
                nameHydration: {
                    status: "loaded",
                    sourceLabel: "local_snapshot",
                    configuredFrom: "STFC_LOCAL_NAME_SNAPSHOT_DIR",
                    rootPath: "D:\\dev\\stfc-local-name-snapshot",
                    sourceReconciliationNote: "Names come from a local snapshot. Other catalogs may label the same IDs differently.",
                },
            },
        });

        expect(explanation.runtimeEffects[0]).toMatchObject({
            label: "Hugh below-decks effect#1120204726 observed at 0.7",
            sourceName: "Hugh",
            effectLabel: "effect#1120204726",
            nameResolution: "source:local_snapshot | effect:fallback_ref",
        });
        expect(explanation.runtimeEffectsMeta.nameHydration).toMatchObject({
            status: "loaded",
            sourceLabel: "local_snapshot",
            configuredFrom: "STFC_LOCAL_NAME_SNAPSHOT_DIR",
            rootPath: "D:\\dev\\stfc-local-name-snapshot",
            sourceReconciliationNote: "Names come from a local snapshot. Other catalogs may label the same IDs differently.",
        });
    });

    test("keeps the full ID fallback sentence when neither source nor effect names resolve", () => {
        const explanation = buildBattleExplanation({
            battleId: "battle-1",
            runtimeEffectOverlay: {
                resolvedRuntimeEffects: [
                    {
                        sourceDomain: "officer",
                        sourceRef: "4290764940",
                        sourceName: null,
                        sourceNameResolution: "fallback_ref",
                        sourceLocaKey: "50001",
                        effectRef: "1120204726",
                        effectSlot: "belowDecksAbilityId",
                        effectName: null,
                        effectNameResolution: "fallback_ref",
                        valueDisplay: "0.7",
                        phase: "post_attack",
                        triggered: false,
                        confidence: "exact_catalog_field_match",
                    },
                ],
                coverage: { unresolvedRefs: [] },
                nameHydration: {
                    status: "loaded",
                    sourceLabel: "local_snapshot",
                    configuredFrom: "STFC_LOCAL_NAME_SNAPSHOT_DIR",
                    rootPath: "D:\\dev\\stfc-local-name-snapshot",
                },
            },
        });

        expect(explanation.runtimeEffects[0]).toMatchObject({
            label: "Officer#4290764940 below-decks effect observed at 0.7",
            sourceLabel: "Officer#4290764940",
            effectLabel: "effect#1120204726",
            nameResolution: "source:fallback_ref | effect:fallback_ref",
        });
    });
});

function analyticsEvent() {
    return {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "battle.analytics",
        schemaVersion: "stfc.battle.analytics.v0",
        timestamp: "2026-06-04T20:00:03.000Z",
        journalId: "journal-1",
        battleId: "battle-1",
        battleType: 8,
        analytics: {
            summary: { outcome: "initiator_victory", roundCount: 2 },
            attackRows: [
                attackRow("ship-a", "ship-b", "812617665", { hull: 100, shield: 200, mitigated: 10, totalIsolytic: 50 }, true),
                attackRow("ship-a", "ship-b", "812617665", { hull: 50, shield: 0, mitigated: 5, totalIsolytic: 150 }, "YES"),
                attackRow("ship-b", "ship-a", "9999999999", { hull: 25, shield: 10, mitigated: 2, totalIsolytic: 0 }, false),
            ],
            experimental: {
                runtimeAbilityRowCandidates: [],
                resolver: { status: "scan_only" },
            },
            csvParity: {
                coverage: { abilityRowCount: 0 },
            },
        },
    };
}

function attackRow(attackerShipId, targetShipId, componentId, damage, critical) {
    return {
        round: 1,
        subRound: 1,
        attackerShipIdExact: attackerShipId,
        targetShipIdExact: targetShipId,
        componentIdExact: componentId,
        damage,
        critical: critical === true,
        criticalHit: critical === "YES" ? "YES" : critical === true ? true : false,
    };
}

function reportEvent() {
    return {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "battle.report",
        schemaVersion: "stfc.sidecar.battle-report.v0",
        timestamp: "2026-06-04T20:00:02.000Z",
        journalId: "journal-1",
        battleId: "battle-1",
        battleType: 8,
        report: {
            summary: { outcome: "initiator_victory", roundCount: 2 },
            fleets: [
                { side: "initiator", uid: "player-1", displayName: "Raw Player", shipIdsExact: ["ship-a"], hullIdsExact: ["311330874"] },
                { side: "target", uid: "hostile-1", displayName: "Lv.60 L60 Exborg Explorer", shipIdsExact: ["ship-b"], hullIdsExact: ["2222222222"] },
            ],
        },
    };
}

function captureEvent() {
    return {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "battle.capture",
        schemaVersion: "stfc.battle.capture.v1",
        timestamp: "2026-06-04T20:00:01.000Z",
        journalId: "journal-1",
        battleId: "battle-1",
        battleType: 8,
        capture: {
            sourceKind: "scopely.journal.battle",
            participants: [],
        },
    };
}

function catalogSnapshot() {
    return {
        protocolVersion: "stfc.sidecar.events.v0",
        type: "catalog.snapshot",
        schemaVersion: "stfc.catalog.snapshot.v0",
        timestamp: "2026-06-04T20:00:02.500Z",
        journalId: "journal-1",
        battleId: "battle-1",
        battleType: 8,
        scope: "battle",
        catalog: {
            domains: {
                players: {
                    "player-1": { id: "player-1", name: "Guffawaffle", unresolved: false },
                    "hostile-1": { id: "hostile-1", name: "Lv.60 L60 Exborg Explorer", unresolved: false },
                },
                hulls: {
                    "311330874": { id: "311330874", name: "USS Northcutt", type: "Destroyer", unresolved: false },
                    "2222222222": { id: "2222222222", name: "Lv.60 L60 Exborg Explorer", type: "Explorer", unresolved: false },
                },
                components: {
                    "812617665": { id: "812617665", name: "Weap Energy G5 Destroyer Fed Uncommon W1 T6", unresolved: false },
                    "9999999999": { id: "9999999999", name: "Hostile Energy Weapon", unresolved: false },
                },
                officers: {
                    "4290764940": {
                        id: "4290764940",
                        name: "Borg Hugh",
                        unresolved: true,
                        locaKey: "50001",
                        belowDecksAbilityId: "1120204726",
                    },
                },
                abilities: {
                    "1120204726": {
                        id: "1120204726",
                        name: "Adaptive Analysis",
                        unresolved: false,
                    },
                },
            },
            coverage: {
                domainsPresent: ["players", "hulls", "components", "officers", "abilities"],
                domainsResolved: ["players", "hulls", "components", "abilities"],
                domainsUnresolved: ["officers"],
                totalEntries: 9,
                resolvedEntries: 8,
            },
        },
    };
}

function runtimeEffectOverlay() {
    return {
        schema: "stfc.battle.resolved_runtime_effect_overlay.v0",
        battleId: "battle-1",
        journalId: "journal-1",
        resolvedRuntimeEffects: [
            {
                schema: "stfc.battle.resolved_runtime_effect.v0",
                sourceDomain: "officer",
                sourceRef: "4290764940",
                sourceName: "Borg Hugh",
                sourceLocaKey: "50001",
                effectRef: "1120204726",
                effectSlot: "belowDecksAbilityId",
                effectName: "Adaptive Analysis",
                valueDisplay: "0.7",
                phase: "post_attack",
                triggered: true,
                confidence: "exact_catalog_field_match",
            },
            {
                schema: "stfc.battle.resolved_runtime_effect.v0",
                sourceDomain: "officer",
                sourceRef: "4290764940",
                sourceName: "Borg Hugh",
                sourceLocaKey: "50001",
                effectRef: "1120204726",
                effectSlot: "belowDecksAbilityId",
                effectName: "Adaptive Analysis",
                valueDisplay: "0.7",
                phase: "pre_attack",
                triggered: false,
                confidence: "exact_catalog_field_match",
            },
            {
                schema: "stfc.battle.resolved_runtime_effect.v0",
                sourceDomain: null,
                sourceRef: "999",
                effectRef: "888",
                valueDisplay: "1",
                phase: "post_attack",
                triggered: false,
                confidence: "unresolved",
            },
        ],
        coverage: {
            candidateCount: 3,
            structurallyResolvedCount: 2,
            unresolvedCount: 1,
            domainsResolved: ["officer"],
            unresolvedRefs: ["999", "888"],
        },
        nameHydration: {
            status: "unavailable",
            sourceLabel: "unavailable",
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
