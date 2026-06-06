const BATTLE_EXPLANATION_SCHEMA = "stfc.battle.explanation.v0";
const BATTLE_TIMELINE_SCHEMA = "stfc.battle.timeline.v0";

const NON_CLAIMS = Object.freeze([
    "Runtime effects are observed candidate rows, not finalized proc-rate math.",
    "Opportunity counts, stacking, refresh, and expiry are not yet inferred.",
    "CSV ability rows remain unpromoted.",
]);

const SIDE_ORDER = Object.freeze(["initiator", "target", "unknown"]);
const TIMELINE_PHASE_ORDER = Object.freeze({
    round_start: 10,
    pre_attack: 20,
    attack: 30,
    mitigation: 40,
    post_attack: 50,
    status: 60,
    unresolved_candidate: 90,
});

export function buildBattleExplanation({
    battleId,
    reportEvent,
    captureEvent,
    analyticsEvent,
    catalogSnapshotEvent,
    runtimeEffectOverlay,
} = {}) {
    const report = isRecord(reportEvent?.report) ? reportEvent.report : {};
    const capture = isRecord(captureEvent?.capture) ? captureEvent.capture : {};
    const analytics = isRecord(analyticsEvent?.analytics) ? analyticsEvent.analytics : {};
    const catalog = catalogIndex(catalogSnapshotEvent);
    const attackRows = attackRowsFrom(report, analytics);
    const participants = buildParticipants(report, capture, catalog);
    const shipSide = buildShipSideIndex(participants);
    const outcome = buildOutcome(report, analytics, capture, attackRows);
    const damageSummary = buildDamageSummary(attackRows, shipSide);
    const weaponSummary = buildWeaponSummary(attackRows, shipSide, catalog);
    const runtimeEffects = buildRuntimeEffects(runtimeEffectOverlay);
    const runtimeEffectsMeta = buildRuntimeEffectsMeta(runtimeEffectOverlay, runtimeEffects);
    const unresolved = buildUnresolved(runtimeEffectOverlay, participants, weaponSummary, catalog);
    const battleTimeline = buildBattleTimeline({
        battleId,
        analyticsEvent,
        reportEvent,
        captureEvent,
        participants,
        attackRows,
        runtimeEffectOverlay,
        outcome,
    });

    return {
        schema: BATTLE_EXPLANATION_SCHEMA,
        battleId: exactString(battleId)
            ?? exactString(analyticsEvent?.battleId)
            ?? exactString(reportEvent?.battleId)
            ?? exactString(captureEvent?.battleId)
            ?? null,
        headline: buildHeadline(participants, outcome),
        participants,
        outcome,
        damageSummary,
        weaponSummary,
        runtimeEffects,
        runtimeEffectsMeta,
        unresolved,
        battleTimeline,
        safeClaims: buildSafeClaims(runtimeEffects, unresolved),
        nonClaims: [...NON_CLAIMS],
    };
}

function buildParticipants(report, capture, catalog) {
    const rawParticipants = Array.isArray(report.fleets) && report.fleets.length > 0
        ? report.fleets
        : arrayFrom(capture.participants);

    return rawParticipants.map((raw, index) => {
        const side = exactString(raw.side) ?? (index === 0 ? "initiator" : index === 1 ? "target" : "unknown");
        const uid = firstId(raw.uid, raw.playerId, raw.player_id, raw.fleetId, raw.fleet_id);
        const player = uid ? catalog.lookup("players", uid) : null;
        const shipIds = idsFrom(raw.shipIdsExact, raw.ship_ids_exact, raw.shipIds, raw.ship_ids);
        const hullIds = idsFrom(raw.hullIdsExact, raw.hull_ids_exact, raw.hullIds, raw.hull_ids);
        const hullId = hullIds[0] ?? null;
        const hull = hullId ? catalog.lookup("hulls", hullId) : null;
        const componentIds = idsFrom(
            raw.componentIdsExact,
            raw.component_ids_exact,
            raw.componentIds,
            raw.component_ids,
        );
        const displayName = entryName(player)
            ?? text(raw.displayName)
            ?? text(raw.display_name)
            ?? text(raw.name)
            ?? uid
            ?? `Combatant ${index + 1}`;

        return {
            side,
            displayName,
            shipLabel: entryName(hull) ?? text(raw.shipName) ?? text(raw.ship_name) ?? displayName,
            shipIds,
            hullId,
            hullType: entryType(hull),
            componentIds,
            participantKind: text(raw.participantKind) ?? text(raw.participant_kind),
            uid,
        };
    });
}

function buildShipSideIndex(participants) {
    const index = new Map();
    for (const participant of participants) {
        for (const shipId of arrayFrom(participant.shipIds)) {
            index.set(shipId, participant.side);
        }
    }
    return index;
}

function buildOutcome(report, analytics, capture, attackRows) {
    const summary = firstRecord(report.summary, analytics.summary, capture.summary);
    const outcomeText = text(summary.outcome);
    const winnerSide = summary.initiatorWins === true || outcomeText === "initiator_victory"
        ? "initiator"
        : summary.initiatorWins === false || outcomeText === "target_victory"
            ? "target"
            : null;
    const roundCount = numberOrNull(summary.roundCount)
        ?? maxNumber(attackRows.map((row) => numberOrNull(row.round)))
        ?? null;

    return {
        winnerSide,
        roundCount,
        attackRowCount: attackRows.length,
    };
}

function buildDamageSummary(attackRows, shipSide) {
    const totals = {
        initiator: emptyDamageTotals(),
        target: emptyDamageTotals(),
        unknown: emptyDamageTotals(),
    };

    for (const row of attackRows) {
        const side = sideForAttackRow(row, shipSide);
        addDamage(totals[side] ?? totals.unknown, damageFromRow(row));
    }

    return Object.fromEntries(SIDE_ORDER.map((side) => [side, displayDamageTotals(totals[side])]));
}

function buildWeaponSummary(attackRows, shipSide, catalog) {
    const groups = new Map();
    for (const row of attackRows) {
        const componentId = firstId(row.componentIdExact, row.component_id_exact, row.componentId, row.component_id);
        if (!componentId) {
            continue;
        }
        const ownerSide = sideForAttackRow(row, shipSide);
        const key = `${ownerSide}\u001f${componentId}`;
        const group = groups.get(key) ?? {
            ownerSide,
            componentId,
            componentName: entryName(catalog.lookup("components", componentId)),
            attackCount: 0,
            criticalCount: 0,
            damage: emptyDamageTotals(),
        };
        group.attackCount += 1;
        if (row.critical === true || row.criticalHit === true || text(row.criticalHit)?.toUpperCase() === "YES") {
            group.criticalCount += 1;
        }
        addDamage(group.damage, damageFromRow(row));
        groups.set(key, group);
    }

    return [...groups.values()]
        .map((group) => ({
            ownerSide: group.ownerSide,
            componentId: group.componentId,
            componentName: group.componentName,
            attackCount: group.attackCount,
            criticalCount: group.criticalCount,
            ...displayDamageTotals(group.damage),
        }))
        .sort((left, right) => {
            const damageDelta = rawDamageTotal(right) - rawDamageTotal(left);
            return damageDelta !== 0 ? damageDelta : left.componentId.localeCompare(right.componentId);
        });
}

function buildRuntimeEffects(runtimeEffectOverlay) {
    const groups = new Map();
    for (const effect of arrayFrom(runtimeEffectOverlay?.resolvedRuntimeEffects).filter(isRecord)) {
        const key = [
            exactString(effect.sourceRef) ?? "",
            exactString(effect.effectRef) ?? "",
            exactString(effect.effectSlot) ?? "",
            exactString(effect.valueDisplay) ?? "",
            exactString(effect.confidence) ?? "",
        ].join("\u001f");
        const group = groups.get(key) ?? {
            sourceDomain: exactString(effect.sourceDomain),
            sourceRef: exactString(effect.sourceRef),
            sourceName: text(effect.sourceName),
            sourceLocaKey: exactString(effect.sourceLocaKey),
            sourceNameResolution: exactString(effect.sourceNameResolution) ?? "fallback_ref",
            sourceNameSource: exactString(effect.sourceNameSource),
            effectRef: exactString(effect.effectRef),
            effectSlot: exactString(effect.effectSlot),
            effectName: text(effect.effectName),
            effectNameResolution: exactString(effect.effectNameResolution) ?? "fallback_ref",
            effectNameSource: exactString(effect.effectNameSource),
            valueDisplay: exactString(effect.valueDisplay),
            confidence: exactString(effect.confidence) ?? "unresolved",
            observedCount: 0,
            triggeredCount: 0,
            phases: new Set(),
        };
        group.observedCount += 1;
        if (effect.triggered === true) {
            group.triggeredCount += 1;
        }
        if (effect.phase) {
            group.phases.add(String(effect.phase));
        }
        groups.set(key, group);
    }

    return [...groups.values()].map((group) => {
        const sourceLabel = sourceEffectLabel(group);
        const effectLabel = effectDisplayLabel(group);
        return {
            label: runtimeEffectSentence(group, sourceLabel, effectLabel),
            sourceDomain: group.sourceDomain,
            sourceRef: group.sourceRef,
            sourceName: group.sourceName,
            sourceLocaKey: group.sourceLocaKey,
            sourceNameResolution: group.sourceNameResolution,
            sourceNameSource: group.sourceNameSource,
            sourceLabel,
            effectRef: group.effectRef,
            effectSlot: group.effectSlot,
            effectName: group.effectName,
            effectNameResolution: group.effectNameResolution,
            effectNameSource: group.effectNameSource,
            effectLabel,
            valueDisplay: group.valueDisplay,
            triggeredCount: group.triggeredCount,
            observedCount: group.observedCount,
            phases: [...group.phases].sort(),
            confidence: group.confidence,
            nameResolution: combinedNameResolution(group),
            humanClaim: humanRuntimeEffectClaim(group),
        };
    });
}

function buildRuntimeEffectsMeta(runtimeEffectOverlay, runtimeEffects) {
    const nameHydration = isRecord(runtimeEffectOverlay?.nameHydration) ? runtimeEffectOverlay.nameHydration : {};

    return {
        structuralNote: NON_CLAIMS[0],
        structuralMatchCount: numberOrNull(runtimeEffectOverlay?.coverage?.structurallyResolvedCount)
            ?? runtimeEffects.filter((effect) => effect.confidence === "exact_catalog_field_match").length,
        candidateCount: numberOrNull(runtimeEffectOverlay?.coverage?.candidateCount) ?? runtimeEffects.length,
        unresolvedCount: numberOrNull(runtimeEffectOverlay?.coverage?.unresolvedCount)
            ?? runtimeEffects.filter((effect) => effect.confidence !== "exact_catalog_field_match").length,
        nameHydration: {
            status: exactString(nameHydration.status) ?? "unavailable",
            sourceLabel: exactString(nameHydration.sourceLabel) ?? "unavailable",
            configuredPath: exactString(nameHydration.configuredPath),
            configuredFrom: exactString(nameHydration.configuredFrom),
            rootPath: exactString(nameHydration.rootPath),
            snapshotVersion: exactString(nameHydration.snapshotVersion),
            availableFiles: isRecord(nameHydration.availableFiles) ? nameHydration.availableFiles : {},
            sourceReconciliationNote: exactString(nameHydration.sourceReconciliationNote)
                ?? "Names may vary across catalogs. Exact refs remain available for provenance.",
        },
    };
}

function buildUnresolved(runtimeEffectOverlay, participants, weaponSummary, catalog) {
    const runtimeEffectRefs = arrayFrom(runtimeEffectOverlay?.coverage?.unresolvedRefs).filter((value) => typeof value === "string");
    const catalogRefs = new Set();

    for (const participant of participants) {
        if (participant.hullId && !catalog.lookup("hulls", participant.hullId)) {
            catalogRefs.add(participant.hullId);
        }
    }
    for (const weapon of weaponSummary) {
        if (weapon.componentId && !catalog.lookup("components", weapon.componentId)) {
            catalogRefs.add(weapon.componentId);
        }
    }

    return {
        runtimeEffectRefs: [...new Set(runtimeEffectRefs)].sort(),
        catalogRefs: [...catalogRefs].sort(),
    };
}

function buildSafeClaims(runtimeEffects, unresolved) {
    const resolvedCount = runtimeEffects.filter((effect) => effect.confidence === "exact_catalog_field_match").length;
    const claims = [
        "Attack and damage totals are derived from existing attack rows.",
        "Runtime effect explanations are derived from sidecar catalog joins, not native live resolver callbacks.",
    ];
    if (resolvedCount > 0) {
        claims.push(`${resolvedCount} runtime effect group${resolvedCount === 1 ? "" : "s"} structurally matched catalog fields.`);
    }
    if (unresolved.runtimeEffectRefs.length > 0 || unresolved.catalogRefs.length > 0) {
        claims.push("Some refs remain unresolved and are preserved for drill-down.");
    }
    return claims;
}

function buildHeadline(participants, outcome) {
    const initiator = participants.find((participant) => participant.side === "initiator") ?? participants[0] ?? null;
    const target = participants.find((participant) => participant.side === "target") ?? participants[1] ?? null;
    const winner = participants.find((participant) => participant.side === outcome.winnerSide) ?? null;
    const loser = participants.find((participant) => participant.side !== outcome.winnerSide && participant.side !== "unknown")
        ?? (winner === initiator ? target : initiator);
    const rounds = outcome.roundCount ? ` in ${outcome.roundCount} ${outcome.roundCount === 1 ? "round" : "rounds"}` : "";

    if (winner && loser) {
        return `${participantBattleLabel(winner)} defeated ${participantBattleLabel(loser)}${rounds}.`;
    }
    if (initiator && target) {
        return `${participantBattleLabel(initiator)} fought ${participantBattleLabel(target)}${rounds}.`;
    }
    if (initiator) {
        return `${participantBattleLabel(initiator)} battle captured${rounds}.`;
    }
    return outcome.attackRowCount > 0 ? `Battle captured with ${outcome.attackRowCount} attack rows.` : "Battle explanation pending source data.";
}

function participantBattleLabel(participant) {
    return participant.shipLabel || participant.displayName || participant.side;
}

function sourceEffectLabel(group) {
    if (group.sourceName) {
        return group.sourceName;
    }
    const domain = group.sourceDomain === "officer"
        ? "Officer"
        : group.sourceDomain === "hull"
            ? "Hull"
            : group.sourceDomain === "component"
                ? "Component"
                : "Ref";
    return `${domain}#${group.sourceRef ?? "unknown"}`;
}

function effectDisplayLabel(group) {
    if (group.effectName) {
        return group.effectName;
    }
    return `effect#${group.effectRef ?? "unknown"}`;
}

function runtimeEffectSentence(group, sourceLabel, effectLabel) {
    const slot = slotLabel(group.effectSlot);
    if (group.effectName) {
        return `${sourceLabel} ${slot} ${effectLabel} observed at ${group.valueDisplay ?? "unknown"}`;
    }
    if (group.sourceName && group.effectRef) {
        return `${sourceLabel} ${slot} ${effectLabel} observed at ${group.valueDisplay ?? "unknown"}`;
    }
    return `${sourceLabel} ${slot} effect observed at ${group.valueDisplay ?? "unknown"}`;
}

function slotLabel(slot) {
    switch (slot) {
        case "belowDecksAbilityId": return "below-decks";
        case "captainManeuverId": return "captain maneuver";
        case "officerAbilityId": return "officer ability";
        case "hull_or_ship_effect": return "hull/ship";
        case "component_effect": return "component";
        default: return "runtime";
    }
}

function humanRuntimeEffectClaim(group) {
    if (group.confidence === "exact_catalog_field_match" && group.sourceDomain === "officer") {
        return `Observed as a structurally matched ${slotLabel(group.effectSlot)} officer effect. Not yet promoted to final proc math.`;
    }
    if (group.confidence === "exact_catalog_field_match" && group.sourceDomain === "hull") {
        return "Observed as a structurally matched hull or ship effect. Not yet promoted to final proc math.";
    }
    return "Observed as an unresolved runtime effect candidate. Not yet promoted to final proc math.";
}

function combinedNameResolution(group) {
    return [
        `source:${group.sourceNameResolution ?? "fallback_ref"}`,
        `effect:${group.effectNameResolution ?? "fallback_ref"}`,
    ].join(" | ");
}

function attackRowsFrom(report, analytics) {
    if (Array.isArray(analytics.attackRows) && analytics.attackRows.length > 0) {
        return analytics.attackRows.filter(isRecord);
    }
    if (Array.isArray(report.attackRows) && report.attackRows.length > 0) {
        return report.attackRows.filter(isRecord);
    }
    const csvRows = isRecord(analytics.csvParity) ? analytics.csvParity.rows : null;
    return Array.isArray(csvRows) ? csvRows.filter(isRecord) : [];
}

function sideForAttackRow(row, shipSide) {
    const explicit = exactString(row.attackerSide) ?? exactString(row.ownerSide) ?? exactString(row.side);
    if (explicit) {
        return normalizeSide(explicit);
    }

    const attackerShipId = firstId(
        row.attackerShipIdExact,
        row.attacker_ship_id_exact,
        isRecord(row.attacker) ? row.attacker.shipIdExact : null,
        row.attackerShipId,
        row.attacker_ship_id,
        isRecord(row.attacker) ? row.attacker.shipId : null,
    );
    return attackerShipId ? normalizeSide(shipSide.get(attackerShipId)) : "unknown";
}

function damageFromRow(row) {
    const damage = isRecord(row.damage) ? row.damage : {};
    return {
        hull: numeric(row.hullDamage, damage.hull),
        shield: numeric(row.shieldDamage, damage.shield),
        mitigated: numeric(row.mitigatedDamage, damage.mitigated),
        mitigatedIsolytic: numeric(row.mitigatedIsolyticDamage, damage.mitigatedIsolyticDamage, damage.unknownScalarA),
        mitigatedApexBarrier: numeric(row.mitigatedApexBarrier, damage.mitigatedApexBarrier, damage.unknownScalarB),
        isolytic: numeric(row.totalIsolyticDamage, row.totalIsolytic, damage.totalIsolytic, damage.isolytic),
    };
}

function emptyDamageTotals() {
    return { hull: 0, shield: 0, mitigated: 0, mitigatedIsolytic: 0, mitigatedApexBarrier: 0, isolytic: 0 };
}

function addDamage(total, damage) {
    total.hull += damage.hull ?? 0;
    total.shield += damage.shield ?? 0;
    total.mitigated += damage.mitigated ?? 0;
    total.mitigatedIsolytic += damage.mitigatedIsolytic ?? 0;
    total.mitigatedApexBarrier += damage.mitigatedApexBarrier ?? 0;
    total.isolytic += damage.isolytic ?? 0;
}

function displayDamageTotals(total) {
    return {
        hullDamageDisplay: displayNumber(total.hull),
        shieldDamageDisplay: displayNumber(total.shield),
        mitigatedDamageDisplay: displayNumber(total.mitigated),
        mitigatedIsolyticDamageDisplay: displayNumber(total.mitigatedIsolytic),
        mitigatedApexBarrierDisplay: displayNumber(total.mitigatedApexBarrier),
        isolyticDamageDisplay: displayNumber(total.isolytic),
    };
}

function buildBattleTimeline({
    battleId,
    analyticsEvent,
    reportEvent,
    captureEvent,
    participants,
    attackRows,
    runtimeEffectOverlay,
    outcome,
} = {}) {
    const participantIndex = buildTimelineParticipantIndex(participants);
    const events = [
        ...buildRuntimeTimelineEvents(runtimeEffectOverlay, participantIndex),
        ...buildAttackTimelineEvents(attackRows, participantIndex),
    ].sort(compareTimelineEvents)
        .map((event, index) => removeUndefined({
            ...event,
            sequence: index + 1,
            sortKey: undefined,
        }));

    const unresolvedCandidates = arrayFrom(runtimeEffectOverlay?.resolvedRuntimeEffects)
        .filter((effect) => isRecord(effect) && effect.confidence !== "exact_catalog_field_match")
        .map((effect, index) => unresolvedTimelineCandidate(effect, index, participantIndex));

    return {
        schema: BATTLE_TIMELINE_SCHEMA,
        battleId: exactString(battleId)
            ?? exactString(analyticsEvent?.battleId)
            ?? exactString(reportEvent?.battleId)
            ?? exactString(captureEvent?.battleId)
            ?? null,
        participantsByShipIdExact: participantIndex.participantsByShipIdExact,
        summary: {
            roundCount: outcome?.roundCount ?? null,
            eventCount: events.length,
            unresolvedCandidateCount: unresolvedCandidates.length,
        },
        events,
        diagnostics: {
            unresolvedCandidates,
            legacyDamageFieldAliases: [
                {
                    rawField: "damage.mitigated",
                    derivedField: "mitigatedStandardDamage",
                    label: "Mitigated Standard Damage",
                },
                {
                    rawField: "damage.unknownScalarA",
                    derivedField: "mitigatedIsolyticDamage",
                    label: "Mitigated Isolytic Damage",
                    evidence: "Native battle report screenshots show this slot as mitigated Isolytic damage.",
                },
                {
                    rawField: "damage.unknownScalarB",
                    derivedField: "mitigatedApexBarrier",
                    label: "Mitigated Apex Barrier",
                    evidence: "Native battle report screenshots show this slot as mitigation using Apex Barrier.",
                },
            ],
        },
        nonClaims: [...NON_CLAIMS],
    };
}

function buildTimelineParticipantIndex(participants) {
    const participantsByShipIdExact = {};
    const shipLookup = new Map();

    for (const participant of participants) {
        for (const shipId of arrayFrom(participant.shipIds)) {
            const entry = removeUndefined({
                shipIdExact: shipId,
                side: participant.side,
                displayName: participant.displayName,
                shipLabel: participant.shipLabel,
                hullId: participant.hullId,
                hullType: participant.hullType,
                participantKind: participant.participantKind,
                uid: participant.uid,
                componentIdsExact: arrayFrom(participant.componentIds),
            });
            participantsByShipIdExact[shipId] = entry;
            shipLookup.set(shipId, entry);
        }
    }

    return { participantsByShipIdExact, shipLookup };
}

function buildRuntimeTimelineEvents(runtimeEffectOverlay, participantIndex) {
    return arrayFrom(runtimeEffectOverlay?.resolvedRuntimeEffects)
        .filter((effect) => isRecord(effect) && effect.confidence === "exact_catalog_field_match")
        .map((effect, index) => {
            const ownerShipId = exactString(effect.ownerShipId);
            const targetShipId = exactString(effect.targetShipId);
            const actor = timelineActor(ownerShipId, participantIndex, effect.ownerHullName ?? sourceEffectLabel(effect));
            const target = timelineActor(targetShipId, participantIndex, effect.targetHullName);
            const source = sourceEffectLabel(effect);
            const ability = effectDisplayLabel(effect);
            const details = [
                source && ability ? `${source} / ${ability}` : source ?? ability,
                effect.valueDisplay ? `Observed value: ${effect.valueDisplay}` : null,
                effect.phase ? `Phase: ${effect.phase}` : null,
            ].filter(Boolean);

            return removeUndefined({
                eventId: `runtime:${effect.candidateIndex ?? index}`,
                type: "ability_applied",
                phase: exactString(effect.phase) ?? "pre_attack",
                round: numberOrNull(effect.round),
                subRound: numberOrNull(effect.subRound),
                actor,
                actorShipIdExact: ownerShipId,
                event: ability ? `${source} - ${ability}` : `${source} observed`,
                target,
                targetShipIdExact: targetShipId,
                details,
                sourceRef: effect.sourceRef,
                effectRef: effect.effectRef,
                effectSlot: effect.effectSlot,
                valueDisplay: effect.valueDisplay,
                confidence: effect.confidence,
                provenance: runtimeNameProvenance(effect),
                sortKey: timelineSortKey(effect.round, effect.subRound, exactString(effect.phase) ?? "pre_attack", index),
            });
        });
}

function buildAttackTimelineEvents(attackRows, participantIndex) {
    return attackRows.flatMap((row, index) => {
        const attackerShipId = firstId(
            row.attackerShipIdExact,
            row.attacker_ship_id_exact,
            isRecord(row.attacker) ? row.attacker.shipIdExact : null,
            row.attackerShipId,
            row.attacker_ship_id,
            isRecord(row.attacker) ? row.attacker.shipId : null,
        );
        const targetShipId = firstId(
            row.targetShipIdExact,
            row.target_ship_id_exact,
            isRecord(row.target) ? row.target.shipIdExact : null,
            row.targetShipId,
            row.target_ship_id,
            isRecord(row.target) ? row.target.shipId : null,
        );
        const componentId = firstId(row.componentIdExact, row.component_id_exact, row.componentId, row.component_id);
        const round = numberOrNull(row.round);
        const subRound = numberOrNull(row.subRound);
        const damage = timelineDamageFromRow(row);
        const actor = timelineActor(attackerShipId, participantIndex, text(row.attackerShip) ?? text(row.attackerName));
        const target = timelineActor(targetShipId, participantIndex, text(row.targetShip) ?? text(row.targetName));
        const critical = row.critical === true || row.criticalHit === true || text(row.criticalHit)?.toUpperCase() === "YES";
        const attackDetails = attackDetailLines(actor, target, damage);
        const events = [
            removeUndefined({
                eventId: `attack:${index}`,
                type: "attack",
                phase: "attack",
                round,
                subRound,
                actor,
                actorShipIdExact: attackerShipId,
                event: critical ? "Critical weapon attack" : "Weapon attack",
                target,
                targetShipIdExact: targetShipId,
                componentIdExact: componentId,
                details: attackDetails,
                damage,
                confidence: "stable_attack_payload_v1",
                source: timelineAttackSource(row),
                metadata: {
                    outgoingDamageFormula: outgoingFormulaStatus(damage),
                },
                sortKey: timelineSortKey(round, subRound, "attack", index),
            }),
        ];

        const mitigationDetails = mitigationDetailLines(damage);
        if (mitigationDetails.length > 0) {
            events.push(removeUndefined({
                eventId: `mitigation:${index}`,
                type: "mitigation",
                phase: "mitigation",
                round,
                subRound,
                actor: target,
                actorShipIdExact: targetShipId,
                event: "Damage mitigated",
                target: actor,
                targetShipIdExact: attackerShipId,
                componentIdExact: componentId,
                details: mitigationDetails,
                damage: {
                    mitigatedStandardDamage: damage.mitigatedStandardDamage,
                    mitigatedIsolyticDamage: damage.mitigatedIsolyticDamage,
                    mitigatedApexBarrier: damage.mitigatedApexBarrier,
                },
                confidence: "native_display_field_projection",
                source: "derived.damage_projection",
                sortKey: timelineSortKey(round, subRound, "mitigation", index),
            }));
        }

        events.push(...statusTimelineEvents(row, index, actor, target, attackerShipId, targetShipId, componentId, damage));
        return events;
    });
}

function attackDetailLines(actor, target, damage) {
    const lines = [];
    if (damage.standardDamage != null) {
        lines.push(`${actor} Deals ${displayIntegerDamage(damage.standardDamage)} Standard damage`);
    }
    if (damage.totalIsolyticDamage != null) {
        lines.push(`${actor} Deals ${displayIntegerDamage(damage.totalIsolyticDamage)} Isolytic damage`);
    }
    if (damage.shieldDamage != null) {
        lines.push(`${target} Receives ${displayIntegerDamage(damage.shieldDamage)} Shield Health damage`);
    }
    if (damage.hullDamage != null) {
        lines.push(`${target} Receives ${displayIntegerDamage(damage.hullDamage)} Hull Health damage`);
    }
    return lines;
}

function mitigationDetailLines(damage) {
    return [
        damage.mitigatedStandardDamage != null
            ? `Mitigates ${displayIntegerDamage(damage.mitigatedStandardDamage)} Standard damage`
            : null,
        damage.mitigatedIsolyticDamage != null
            ? `Mitigates ${displayIntegerDamage(damage.mitigatedIsolyticDamage)} Isolytic damage`
            : null,
        damage.mitigatedApexBarrier != null
            ? `Mitigates ${displayIntegerDamage(damage.mitigatedApexBarrier)} using Apex Barrier`
            : null,
    ].filter(Boolean);
}

function statusTimelineEvents(row, index, actor, target, attackerShipId, targetShipId, componentId, damage) {
    const round = numberOrNull(row.round);
    const subRound = numberOrNull(row.subRound);
    const events = [];

    if (damage.targetShieldRemaining === 0 && (damage.shieldDamage ?? 0) > 0) {
        events.push(removeUndefined({
            eventId: `shield-depleted:${index}`,
            type: "shield_depleted",
            phase: "status",
            round,
            subRound,
            actor: target,
            actorShipIdExact: targetShipId,
            event: "Shield depleted",
            target: actor,
            targetShipIdExact: attackerShipId,
            componentIdExact: componentId,
            details: [`${target} Shield Health reached 0`],
            confidence: "derived_from_remaining_health",
            source: "derived.damage_projection",
            sortKey: timelineSortKey(round, subRound, "status", index),
        }));
    }

    const targetDefeated = damage.targetHullRemaining === 0 && (damage.hullDamage ?? 0) > 0
        || row.targetDefeated === true
        || row.targetDestroyed === true
        || text(row.targetDefeated)?.toUpperCase() === "YES"
        || text(row.targetDestroyed)?.toUpperCase() === "YES";
    if (targetDefeated) {
        events.push(removeUndefined({
            eventId: `target-defeated:${index}`,
            type: "status",
            phase: "status",
            round,
            subRound,
            actor,
            actorShipIdExact: attackerShipId,
            event: "Target defeated",
            target,
            targetShipIdExact: targetShipId,
            componentIdExact: componentId,
            details: [`${target} Hull Health reached 0`],
            confidence: damage.targetHullRemaining === 0 ? "derived_from_remaining_health" : "csv_status_field",
            source: "derived.damage_projection",
            sortKey: timelineSortKey(round, subRound, "status", index + 0.1),
        }));
    }

    if (damage.chargingWeaponsPercent != null) {
        events.push(removeUndefined({
            eventId: `weapon-charged:${index}`,
            type: "weapon_charged",
            phase: "status",
            round,
            subRound,
            actor,
            actorShipIdExact: attackerShipId,
            event: "Weapon charge observed",
            target,
            targetShipIdExact: targetShipId,
            componentIdExact: componentId,
            details: [`Charging Weapons ${displayNumber(damage.chargingWeaponsPercent)}%`],
            confidence: "csv_status_field",
            source: "derived.damage_projection",
            sortKey: timelineSortKey(round, subRound, "status", index + 0.2),
        }));
    }

    return events;
}

function timelineDamageFromRow(row) {
    const damage = isRecord(row.damage) ? row.damage : {};
    return removeUndefined({
        hullDamage: numericOrNull(row.hullDamage, damage.hull),
        targetHullRemaining: numericOrNull(row.targetHullRemaining, damage.targetHullRemaining),
        shieldDamage: numericOrNull(row.shieldDamage, damage.shield),
        targetShieldRemaining: numericOrNull(row.targetShieldRemaining, damage.targetShieldRemaining),
        mitigatedStandardDamage: numericOrNull(row.mitigatedDamage, row.mitigatedStandardDamage, damage.mitigated),
        mitigatedIsolyticDamage: numericOrNull(row.mitigatedIsolyticDamage, damage.mitigatedIsolyticDamage, damage.unknownScalarA),
        mitigatedApexBarrier: numericOrNull(row.mitigatedApexBarrier, damage.mitigatedApexBarrier, damage.unknownScalarB),
        standardDamage: numericOrNull(row.standardDamage, damage.standard, damage.standardDamage),
        totalIsolyticDamage: numericOrNull(row.totalIsolyticDamage, row.totalIsolytic, damage.totalIsolytic, damage.isolytic),
        chargingWeaponsPercent: numericOrNull(row.chargingWeaponsPercent, damage.chargingWeaponsPercent),
    });
}

function timelineAttackSource(row) {
    if (row.sourceKind) {
        return String(row.sourceKind);
    }
    if (row.sourceSegmentIndex != null || row.sourceRecordIndex != null) {
        return "decoded_attack_record";
    }
    return "battle.analytics.attackRows";
}

function outgoingFormulaStatus(damage) {
    return damage.standardDamage == null
        ? "standard damage is shown only when an explicit source field exists"
        : "explicit source field";
}

function unresolvedTimelineCandidate(effect, index, participantIndex) {
    const actor = timelineActor(exactString(effect.ownerShipId), participantIndex, sourceEffectLabel(effect));
    return removeUndefined({
        eventId: `unresolved:${effect.candidateIndex ?? index}`,
        type: "unresolved_candidate",
        phase: exactString(effect.phase) ?? "unresolved_candidate",
        round: numberOrNull(effect.round),
        subRound: numberOrNull(effect.subRound),
        actor,
        actorShipIdExact: exactString(effect.ownerShipId),
        event: `${sourceEffectLabel(effect)} -> ${effectDisplayLabel(effect)}`,
        sourceRef: effect.sourceRef,
        effectRef: effect.effectRef,
        valueDisplay: effect.valueDisplay,
        confidence: effect.confidence ?? "unresolved",
    });
}

function timelineActor(shipId, participantIndex, fallback) {
    const participant = shipId ? participantIndex.shipLookup.get(shipId) : null;
    return participant?.shipLabel ?? participant?.displayName ?? fallback ?? "Unknown";
}

function runtimeNameProvenance(effect) {
    return [
        effect.sourceNameSource ? `source:${effect.sourceNameSource}` : `source:${effect.sourceNameResolution ?? "fallback_ref"}`,
        effect.effectNameSource ? `effect:${effect.effectNameSource}` : `effect:${effect.effectNameResolution ?? "fallback_ref"}`,
    ].join(" | ");
}

function timelineSortKey(round, subRound, phase, index) {
    const normalizedRound = typeof round === "number" && Number.isFinite(round) ? round : 0;
    const normalizedSubRound = typeof subRound === "number" && Number.isFinite(subRound) ? subRound : 0;
    const phaseRank = TIMELINE_PHASE_ORDER[phase] ?? TIMELINE_PHASE_ORDER.status;
    return [normalizedRound, normalizedSubRound, phaseRank, index];
}

function compareTimelineEvents(left, right) {
    const leftKey = Array.isArray(left.sortKey) ? left.sortKey : [];
    const rightKey = Array.isArray(right.sortKey) ? right.sortKey : [];
    for (let index = 0; index < Math.max(leftKey.length, rightKey.length); index += 1) {
        const delta = Number(leftKey[index] ?? 0) - Number(rightKey[index] ?? 0);
        if (delta !== 0) {
            return delta;
        }
    }
    return 0;
}

function rawDamageTotal(summary) {
    return numberFromDisplay(summary.hullDamageDisplay)
        + numberFromDisplay(summary.shieldDamageDisplay)
        + numberFromDisplay(summary.mitigatedDamageDisplay)
        + numberFromDisplay(summary.isolyticDamageDisplay);
}

function catalogIndex(catalogSnapshotEvent) {
    const domains = isRecord(catalogSnapshotEvent?.catalog?.domains) ? catalogSnapshotEvent.catalog.domains : {};
    return {
        lookup(domain, id) {
            const key = exactString(id);
            if (!key || !isRecord(domains[domain])) {
                return null;
            }
            const entry = domains[domain][key];
            return isRecord(entry) ? entry : null;
        },
    };
}

function idsFrom(...values) {
    return values.flatMap((value) => arrayFrom(value).map(toIdString).filter(Boolean));
}

function firstId(...values) {
    for (const value of values) {
        const id = toIdString(value);
        if (id) {
            return id;
        }
    }
    return null;
}

function toIdString(value) {
    if (typeof value === "string" && value.length > 0) {
        return value;
    }
    if (typeof value === "number" && Number.isSafeInteger(value)) {
        return String(value);
    }
    return null;
}

function numeric(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string") {
            const parsed = Number(value.replace(/,/g, ""));
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return 0;
}

function numericOrNull(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string") {
            const parsed = Number(value.replace(/,/g, ""));
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
    }
    return null;
}

function displayNumber(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value || 0);
}

function displayIntegerDamage(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.trunc(value || 0));
}

function numberFromDisplay(value) {
    return Number(String(value ?? "0").replace(/,/g, "")) || 0;
}

function normalizeSide(value) {
    return value === "initiator" || value === "target" ? value : "unknown";
}

function firstRecord(...values) {
    return values.find(isRecord) ?? {};
}

function maxNumber(values) {
    const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
    return numbers.length > 0 ? Math.max(...numbers) : null;
}

function entryName(entry) {
    return text(entry?.name);
}

function entryType(entry) {
    return text(entry?.type);
}

function text(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function exactString(value) {
    return typeof value === "string" ? value : null;
}

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayFrom(value) {
    return Array.isArray(value) ? value : value == null ? [] : [value];
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
