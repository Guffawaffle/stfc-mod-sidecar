const BATTLE_EXPLANATION_SCHEMA = "stfc.battle.explanation.v0";

const NON_CLAIMS = Object.freeze([
    "Runtime effects are observed candidate rows, not finalized proc-rate math.",
    "Opportunity counts, stacking, refresh, and expiry are not yet inferred.",
    "CSV ability rows remain unpromoted.",
]);

const SIDE_ORDER = Object.freeze(["initiator", "target", "unknown"]);

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
        isolytic: numeric(row.totalIsolyticDamage, row.totalIsolytic, damage.totalIsolytic, damage.isolytic),
    };
}

function emptyDamageTotals() {
    return { hull: 0, shield: 0, mitigated: 0, isolytic: 0 };
}

function addDamage(total, damage) {
    total.hull += damage.hull ?? 0;
    total.shield += damage.shield ?? 0;
    total.mitigated += damage.mitigated ?? 0;
    total.isolytic += damage.isolytic ?? 0;
}

function displayDamageTotals(total) {
    return {
        hullDamageDisplay: displayNumber(total.hull),
        shieldDamageDisplay: displayNumber(total.shield),
        mitigatedDamageDisplay: displayNumber(total.mitigated),
        isolyticDamageDisplay: displayNumber(total.isolytic),
    };
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

function displayNumber(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value || 0);
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
