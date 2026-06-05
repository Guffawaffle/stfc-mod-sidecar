import { getRuntimeEffectNameCatalog } from "./runtime-effect-name-catalog.mjs";

const RUNTIME_EFFECT_SCHEMA = "stfc.battle.resolved_runtime_effect.v0";
const RUNTIME_EFFECT_OVERLAY_SCHEMA = "stfc.battle.resolved_runtime_effect_overlay.v0";
const RUNTIME_EFFECT_SUMMARY_SCHEMA = "stfc.battle.resolved_runtime_effect_summary.v0";
const RUNTIME_EFFECT_COVERAGE_SCHEMA = "stfc.battle.resolved_runtime_effect_coverage.v0";

const OFFICER_EFFECT_SLOTS = Object.freeze([
    "belowDecksAbilityId",
    "officerAbilityId",
    "captainManeuverId",
]);

export function buildResolvedRuntimeEffectOverlay(analyticsEvent, catalogSnapshotEvent, options = {}) {
    const candidates = runtimeCandidatesFromAnalytics(analyticsEvent);
    const catalog = catalogDomainsFromSnapshot(catalogSnapshotEvent);
    const nameCatalog = isRecord(options.nameCatalog) ? options.nameCatalog : getRuntimeEffectNameCatalog();
    const resolvedRuntimeEffects = candidates.map((candidate, index) => resolveCandidate(candidate, index, catalog, nameCatalog));
    const structurallyResolved = resolvedRuntimeEffects.filter((effect) => effect.confidence === "exact_catalog_field_match");

    return {
        schema: RUNTIME_EFFECT_OVERLAY_SCHEMA,
        battleId: exactString(analyticsEvent?.battleId) ?? exactString(catalogSnapshotEvent?.battleId) ?? null,
        journalId: exactString(analyticsEvent?.journalId) ?? exactString(catalogSnapshotEvent?.journalId) ?? null,
        resolvedRuntimeEffects,
        resolvedRuntimeEffectSummary: summarizeResolvedRuntimeEffects(resolvedRuntimeEffects),
        nameHydration: describeNameHydration(nameCatalog),
        coverage: {
            schema: RUNTIME_EFFECT_COVERAGE_SCHEMA,
            candidateCount: candidates.length,
            structurallyResolvedCount: structurallyResolved.length,
            unresolvedCount: resolvedRuntimeEffects.length - structurallyResolved.length,
            domainsResolved: [...new Set(structurallyResolved.map((effect) => effect.sourceDomain).filter(Boolean))].sort(),
            unresolvedRefs: unresolvedRefsFromEffects(resolvedRuntimeEffects),
        },
    };
}

export function attachResolvedRuntimeEffectOverlay(analyticsEvent, catalogSnapshotEvent, options = {}) {
    const overlay = buildResolvedRuntimeEffectOverlay(analyticsEvent, catalogSnapshotEvent, options);
    if (!analyticsEvent || typeof analyticsEvent !== "object" || analyticsEvent.type !== "battle.analytics") {
        return { event: analyticsEvent, overlay };
    }

    return {
        event: {
            ...analyticsEvent,
            analytics: {
                ...(isRecord(analyticsEvent.analytics) ? analyticsEvent.analytics : {}),
                resolvedRuntimeEffects: overlay.resolvedRuntimeEffects,
                resolvedRuntimeEffectSummary: overlay.resolvedRuntimeEffectSummary,
                resolvedRuntimeEffectCoverage: overlay.coverage,
            },
        },
        overlay,
    };
}

function runtimeCandidatesFromAnalytics(analyticsEvent) {
    const analytics = isRecord(analyticsEvent?.analytics) ? analyticsEvent.analytics : analyticsEvent;
    if (!isRecord(analytics)) {
        return [];
    }

    const experimental = isRecord(analytics.experimental) ? analytics.experimental : {};
    const directCandidates = arrayFrom(experimental.runtimeAbilityRowCandidates);
    if (directCandidates.length > 0) {
        return directCandidates.filter(isRecord);
    }

    const legacyCandidates = arrayFrom(analytics.runtimeAbilityRowCandidates);
    if (legacyCandidates.length > 0) {
        return legacyCandidates.filter(isRecord);
    }

    return arrayFrom(analytics.attackRows)
        .filter(isRecord)
        .flatMap((row) => arrayFrom(row.runtimeAbilityRowCandidates).filter(isRecord));
}

function catalogDomainsFromSnapshot(catalogSnapshotEvent) {
    const catalog = isRecord(catalogSnapshotEvent?.catalog) ? catalogSnapshotEvent.catalog : catalogSnapshotEvent;
    const domains = isRecord(catalog?.domains) ? catalog.domains : {};

    return {
        domains,
        lookup(domain, id) {
            const key = exactString(id);
            if (key === null) {
                return null;
            }
            const bucket = isRecord(domains[domain]) ? domains[domain] : {};
            const entry = bucket[key];
            return isRecord(entry) ? entry : null;
        },
    };
}

function resolveCandidate(candidate, index, catalog, nameCatalog) {
    const sourceRef = exactString(candidate.sourceRef);
    const effectRef = exactString(candidate.effectRef);
    const source = classifySource(candidate, sourceRef, effectRef, catalog, nameCatalog);
    const ownerHullId = firstExactString(
        candidate.ownerHullId,
        isRecord(candidate.ownerShip) ? candidate.ownerShip.hullIdExact : null,
        isRecord(candidate.ownerShip) ? candidate.ownerShip.hullId : null,
    );
    const targetHullId = firstExactString(
        candidate.targetHullId,
        isRecord(candidate.targetShip) ? candidate.targetShip.hullIdExact : null,
        isRecord(candidate.targetShip) ? candidate.targetShip.hullId : null,
    );
    const ownerHull = ownerHullId ? catalog.lookup("hulls", ownerHullId) : null;
    const targetHull = targetHullId ? catalog.lookup("hulls", targetHullId) : null;

    return removeUndefined({
        schema: RUNTIME_EFFECT_SCHEMA,
        candidateIndex: index,
        sourceRef,
        sourceDomain: source.domain,
        sourceName: source.name,
        sourceLocaKey: source.locaKey,
        sourceNameResolution: source.nameResolution,
        sourceNameSource: source.nameSource,
        effectRef,
        effectSlot: source.effectSlot,
        effectDomain: source.effectDomain,
        effectName: source.effectName,
        effectNameResolution: source.effectNameResolution,
        effectNameSource: source.effectNameSource,
        valueDisplay: valueDisplay(candidate),
        phase: exactString(candidate.phase),
        markerKind: exactString(candidate.markerKind),
        triggered: candidate.triggered === true,
        round: numberOrNull(candidate.round),
        subRound: numberOrNull(candidate.subRound),
        ownerShipId: firstExactString(candidate.ownerShipId, isRecord(candidate.ownerShip) ? candidate.ownerShip.shipIdExact : null),
        ownerHullId,
        ownerHullName: entryName(ownerHull),
        ownerHullType: entryType(ownerHull),
        targetShipId: firstExactString(candidate.targetShipId, isRecord(candidate.targetShip) ? candidate.targetShip.shipIdExact : null),
        targetHullId,
        targetHullName: entryName(targetHull),
        targetHullType: entryType(targetHull),
        confidence: source.confidence,
    });
}

function classifySource(candidate, sourceRef, effectRef, catalog, nameCatalog) {
    if (!sourceRef || !effectRef) {
        return unresolvedClassification();
    }

    const hull = catalog.lookup("hulls", sourceRef);
    const effectHull = catalog.lookup("hulls", effectRef);
    if (hull && sourceRef === effectRef) {
        const hullName = entryName(hull);
        return {
            domain: "hull",
            name: hullName,
            locaKey: entryLocaKey(hull),
            effectSlot: "hull_or_ship_effect",
            effectDomain: "hull",
            effectName: entryName(effectHull),
            nameResolution: hullName ? "catalog" : "fallback_ref",
            nameSource: hullName ? "catalog.snapshot" : null,
            effectNameResolution: entryName(effectHull) ? "catalog" : "fallback_ref",
            effectNameSource: entryName(effectHull) ? "catalog.snapshot" : null,
            confidence: "exact_catalog_field_match",
        };
    }

    const officer = catalog.lookup("officers", sourceRef);
    if (officer) {
        const effectSlot = OFFICER_EFFECT_SLOTS.find((slot) => exactString(officer[slot]) === effectRef) ?? null;
        const ability = effectSlot ? catalog.lookup("abilities", effectRef) : null;
        const sourceMatch = resolveNameMatch({
            preferredName: entryName(officer),
            preferredResolution: "catalog",
            preferredSource: "catalog.snapshot",
            fallbackMatch: nameCatalog?.resolveOfficer?.({
                officerId: sourceRef,
                locaKey: entryLocaKey(officer),
            }),
        });
        const effectMatch = resolveNameMatch({
            preferredName: entryName(ability),
            preferredResolution: "catalog",
            preferredSource: "catalog.snapshot",
            fallbackMatch: nameCatalog?.resolveAbility?.({
                officerId: sourceRef,
                effectId: effectRef,
                effectSlot,
            }),
        });
        return {
            domain: "officer",
            name: sourceMatch.name,
            locaKey: entryLocaKey(officer),
            effectSlot,
            effectDomain: effectSlot ? "ability" : null,
            effectName: effectMatch.name,
            nameResolution: sourceMatch.resolution,
            nameSource: sourceMatch.source,
            effectNameResolution: effectMatch.resolution,
            effectNameSource: effectMatch.source,
            confidence: effectSlot ? "exact_catalog_field_match" : "unresolved",
        };
    }

    if (hull || effectHull) {
        const hullName = entryName(hull);
        const effectHullName = entryName(effectHull);
        return {
            domain: hull ? "hull" : null,
            name: hullName,
            locaKey: entryLocaKey(hull),
            effectSlot: hull && (sourceRef === effectRef || effectHull) ? "hull_or_ship_effect" : null,
            effectDomain: effectHull ? "hull" : null,
            effectName: effectHullName,
            nameResolution: hullName ? "catalog" : "fallback_ref",
            nameSource: hullName ? "catalog.snapshot" : null,
            effectNameResolution: effectHullName ? "catalog" : "fallback_ref",
            effectNameSource: effectHullName ? "catalog.snapshot" : null,
            confidence: hull && (sourceRef === effectRef || effectHull) ? "exact_catalog_field_match" : "unresolved",
        };
    }

    const component = catalog.lookup("components", sourceRef);
    if (component && candidateSupportsComponentSource(candidate, sourceRef)) {
        const componentName = entryName(component);
        return {
            domain: "component",
            name: componentName,
            locaKey: entryLocaKey(component),
            effectSlot: sourceRef === effectRef ? "component_effect" : null,
            effectDomain: sourceRef === effectRef ? "component" : null,
            effectName: sourceRef === effectRef ? componentName : null,
            nameResolution: componentName ? "catalog" : "fallback_ref",
            nameSource: componentName ? "catalog.snapshot" : null,
            effectNameResolution: sourceRef === effectRef && componentName ? "catalog" : "fallback_ref",
            effectNameSource: sourceRef === effectRef && componentName ? "catalog.snapshot" : null,
            confidence: sourceRef === effectRef ? "exact_catalog_field_match" : "unresolved",
        };
    }

    return unresolvedClassification();
}

function candidateSupportsComponentSource(candidate, sourceRef) {
    const category = `${exactString(candidate.sourceCategory) ?? ""} ${exactString(candidate.sourceCategoryHint) ?? ""}`.toLowerCase();
    return (
        category.includes("component") ||
        exactString(candidate.componentId) === sourceRef ||
        exactString(candidate.ownerComponentId) === sourceRef
    );
}

function summarizeResolvedRuntimeEffects(effects) {
    const groups = new Map();

    for (const effect of effects) {
        const key = [
            effect.sourceRef ?? "",
            effect.effectRef ?? "",
            effect.effectSlot ?? "",
            effect.valueDisplay ?? "",
            effect.phase ?? "",
            effect.triggered === true ? "true" : "false",
        ].join("\u001f");
        const group = groups.get(key) ?? {
            sourceRef: effect.sourceRef,
            sourceDomain: effect.sourceDomain,
            effectRef: effect.effectRef,
            effectSlot: effect.effectSlot,
            valueDisplay: effect.valueDisplay,
            phase: effect.phase,
            triggered: effect.triggered === true,
            confidence: effect.confidence,
            count: 0,
            countsByRound: {},
            countsBySubRound: {},
        };

        group.count += 1;
        incrementCount(group.countsByRound, effect.round);
        if (effect.round != null && effect.subRound != null) {
            incrementCount(group.countsBySubRound, `${effect.round}.${effect.subRound}`);
        } else {
            incrementCount(group.countsBySubRound, effect.subRound);
        }
        groups.set(key, group);
    }

    return {
        schema: RUNTIME_EFFECT_SUMMARY_SCHEMA,
        totalCandidateCount: effects.length,
        structurallyResolvedCount: effects.filter((effect) => effect.confidence === "exact_catalog_field_match").length,
        groups: [...groups.values()],
    };
}

function unresolvedRefsFromEffects(effects) {
    const refs = new Set();
    for (const effect of effects) {
        if (effect.confidence === "exact_catalog_field_match") {
            continue;
        }
        if (effect.sourceRef) {
            refs.add(effect.sourceRef);
        }
        if (effect.effectRef) {
            refs.add(effect.effectRef);
        }
    }
    return [...refs].sort();
}

function unresolvedClassification() {
    return {
        domain: null,
        name: null,
        locaKey: null,
        effectSlot: null,
        effectDomain: null,
        effectName: null,
        nameResolution: "fallback_ref",
        nameSource: null,
        effectNameResolution: "fallback_ref",
        effectNameSource: null,
        confidence: "unresolved",
    };
}

function describeNameHydration(nameCatalog) {
    return {
        status: exactString(nameCatalog?.status) ?? "unavailable",
        sourceLabel: exactString(nameCatalog?.sourceLabel) ?? "unavailable",
        configuredPath: exactString(nameCatalog?.configuredPath),
        configuredFrom: exactString(nameCatalog?.configuredFrom),
        rootPath: exactString(nameCatalog?.rootPath),
        snapshotVersion: exactString(nameCatalog?.snapshotVersion),
        availableFiles: isRecord(nameCatalog?.availableFiles) ? nameCatalog.availableFiles : {},
        sourceReconciliationNote: exactString(nameCatalog?.sourceReconciliationNote)
            ?? "Names may vary across catalogs. Exact refs remain available for provenance.",
    };
}

function resolveNameMatch({ preferredName, preferredResolution, preferredSource, fallbackMatch }) {
    if (preferredName) {
        return {
            name: preferredName,
            resolution: preferredResolution,
            source: preferredSource,
        };
    }

    if (fallbackMatch?.name) {
        return {
            name: fallbackMatch.name,
            resolution: exactString(fallbackMatch.resolution) ?? "fallback_ref",
            source: exactString(fallbackMatch.source),
        };
    }

    return {
        name: null,
        resolution: "fallback_ref",
        source: null,
    };
}

function valueDisplay(candidate) {
    const explicit = exactString(candidate.valueDisplay);
    if (explicit !== null) {
        return explicit;
    }
    if (typeof candidate.value === "number" && Number.isFinite(candidate.value)) {
        return String(candidate.value);
    }
    if (typeof candidate.value === "string") {
        return candidate.value;
    }
    return null;
}

function incrementCount(target, value) {
    if (value == null || value === "") {
        return;
    }
    const key = String(value);
    target[key] = (target[key] ?? 0) + 1;
}

function entryName(entry) {
    return firstText(
        entry?.displayName,
        entry?.display_name,
        entry?.name,
        entry?.label,
        entry?.title,
        entry?.locaText,
        entry?.loca_text,
        entry?.resolvedName,
        entry?.resolved_name,
    );
}

function entryType(entry) {
    return exactString(entry?.type);
}

function entryLocaKey(entry) {
    return firstExactString(entry?.sourceLocaKey, entry?.locaKey, entry?.locaId, entry?.loca_id, entry?.nameKey);
}

function firstExactString(...values) {
    for (const value of values) {
        const normalized = exactString(value);
        if (normalized !== null) {
            return normalized;
        }
    }
    return null;
}

function exactString(value) {
    return typeof value === "string" ? value : null;
}

function firstText(...values) {
    for (const value of values) {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (normalized) {
            return normalized;
        }
    }
    return null;
}

function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayFrom(value) {
    return Array.isArray(value) ? value : [];
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
