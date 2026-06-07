import {
    buildObservedHostileReferenceSummary,
    matchObservedHostileReference,
} from "./observed-hostile-reference.mjs";

const OBSERVED_HOSTILE_EVENT_TYPE = "observed.hostile";
const DEFAULT_OBSERVATION_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_PAGE_LIMIT = 25;
const MAX_PAGE_LIMIT = 250;
const OBSERVED_HOSTILE_SOURCE_SURFACES = Object.freeze({
    fleet_data_system: Object.freeze({
        surface: "fleet_data_system",
        tier: "tier1_passive_system_view",
        tierLabel: "Passive system view",
        countBehavior: "passive",
        includeInCatalog: true,
        description: "Canonical passive hostile evidence emitted from FleetDataSystem while a system is visible.",
    }),
    prescan_target_widget: Object.freeze({
        surface: "prescan_target_widget",
        tier: "tier2_view_adjacent_ui",
        tierLabel: "View-adjacent UI",
        countBehavior: "supplemental",
        includeInCatalog: true,
        description: "Supplemental target-widget evidence from the pre-scan/engage surface. Useful for drilldown, not counted as passive system-view coverage.",
    }),
    navigation_interaction: Object.freeze({
        surface: "navigation_interaction",
        tier: "tier3_interactive",
        tierLabel: "Interactive",
        countBehavior: "debug_only",
        includeInCatalog: false,
        description: "Navigation or POI interaction context. Debug-only until it is proven reliable for passive hostile cataloging.",
    }),
    quick_scan: Object.freeze({
        surface: "quick_scan",
        tier: "tier3_interactive",
        tierLabel: "Interactive",
        countBehavior: "debug_only",
        includeInCatalog: false,
        description: "Quick-scan or scan-result evidence. Deferred until it can be cleanly separated from passive system viewing.",
    }),
});
const OBSERVED_HOSTILE_SOURCE_SURFACE_CATALOG = Object.freeze(
    Object.values(OBSERVED_HOSTILE_SOURCE_SURFACES).map((surface) => ({ ...surface })),
);

export function buildObservedHostileCatalogSnapshot(snapshot = {}, options = {}) {
    const page = buildObservedHostileCatalogEntriesSnapshot(snapshot, options);

    return {
        ...page,
        detail: "observed-hostile-index",
        totalEntries: page.totalApprox,
        returnedEntries: page.items.length,
        entries: page.items,
    };
}

export function buildObservedHostileCatalogEntriesSnapshot(snapshot = {}, options = {}) {
    const rawEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
    const observedEvents = rawEvents.filter(isObservedHostileEvent);
    const catalogEvents = observedEvents.filter(isCatalogObservedHostileEntry);
    const sourceCoverage = buildObservedHostileSourceCoverage(observedEvents);
    const referenceCatalog = options.referenceCatalog ?? null;
    const groups = buildObservedHostileGroups(catalogEvents, { referenceCatalog });
    const filteredGroups = filterObservedHostileCatalogEntries(groups, options);
    const page = paginateItems(filteredGroups, options, catalogEntryCursor);

    return {
        ok: snapshot.ok !== false,
        source: resolvedObservedHostileSource(snapshot),
        storageBackend: snapshot.storageBackend ?? null,
        exists: snapshot.exists !== false,
        detail: "observed-hostile-catalog-entries",
        generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        pollHintMs: snapshot.pollHintMs,
        totalEvents: snapshot.totalLines ?? rawEvents.length,
        observedEventCount: observedEvents.length,
        scannedEvents: catalogEvents.length,
        passiveScannedEvents: sourceCoverage.passive.eventCount,
        supplementalScannedEvents: sourceCoverage.supplemental.eventCount,
        ignoredEvents: sourceCoverage.ignored.eventCount,
        sourceSurfaceCatalog: observedHostileSourceSurfaceCatalog(),
        sourceCoverage,
        totalApprox: filteredGroups.length,
        unfilteredTotalApprox: groups.length,
        returnedEntries: page.items.length,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        probeStatus: options.probeStatus ?? null,
        referenceCatalog: buildObservedHostileReferenceSummary(referenceCatalog),
        items: page.items,
        error: snapshot.ok === false ? snapshot.error ?? "Observed hostile catalog unavailable" : undefined,
    };
}

export function buildObservedHostileObservationSnapshot(snapshot = {}, options = {}) {
    const rawEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
    const observedEvents = rawEvents.filter(isObservedHostileEvent);
    const catalogEvents = observedEvents.filter(isCatalogObservedHostileEntry);
    const sourceCoverage = buildObservedHostileSourceCoverage(observedEvents);
    const referenceCatalog = options.referenceCatalog ?? null;
    const groups = buildObservedHostileGroups(catalogEvents, { referenceCatalog });
    const entryByKey = new Map(groups.map((entry) => [entry.key, entry]));
    const sightings = buildObservedHostileSightings(catalogEvents);
    const observations = buildSystemObservations(sightings, entryByKey, {
        windowMs: normalizeObservationWindowMs(options.windowMs),
    });
    const filteredObservations = filterSystemObservations(observations, options);
    const page = paginateItems(filteredObservations, options, observationCursor);

    return {
        ok: snapshot.ok !== false,
        source: resolvedObservedHostileSource(snapshot),
        storageBackend: snapshot.storageBackend ?? null,
        exists: snapshot.exists !== false,
        detail: "observed-hostile-observations",
        generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        pollHintMs: snapshot.pollHintMs,
        totalEvents: snapshot.totalLines ?? rawEvents.length,
        observedEventCount: observedEvents.length,
        scannedEvents: catalogEvents.length,
        passiveScannedEvents: sourceCoverage.passive.eventCount,
        supplementalScannedEvents: sourceCoverage.supplemental.eventCount,
        ignoredEvents: sourceCoverage.ignored.eventCount,
        sourceSurfaceCatalog: observedHostileSourceSurfaceCatalog(),
        sourceCoverage,
        totalApprox: filteredObservations.length,
        unfilteredTotalApprox: observations.length,
        returnedObservations: page.items.length,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        observationWindowMs: normalizeObservationWindowMs(options.windowMs),
        probeStatus: options.probeStatus ?? null,
        referenceCatalog: buildObservedHostileReferenceSummary(referenceCatalog),
        items: page.items,
        error: snapshot.ok === false ? snapshot.error ?? "Observed hostile observations unavailable" : undefined,
    };
}

export function buildObservedHostileGroups(entries = [], options = {}) {
    const groups = new Map();

    for (const entry of entries) {
        if (!entry?.parsed || entry?.event?.type !== OBSERVED_HOSTILE_EVENT_TYPE) {
            continue;
        }

        const event = entry.event;
        const observation = asRecord(event.observation);
        const identity = deriveObservedHostileIdentity(observation);
        const group = groups.get(identity.key) ?? {
            key: identity.key,
            identityKind: identity.kind,
            identityQuality: identity.quality,
            title: observedHostileTitle(observation, identity),
            firstSeenAt: event.timestamp ?? null,
            lastSeenAt: event.timestamp ?? null,
            sightingCount: 0,
            strongestConfidence: null,
            sourceSurfaces: [],
            hullIds: [],
            hullNames: [],
            runtimeFleetIds: [],
            locationTranslationIds: [],
            userIds: [],
            systemIds: [],
            userLevels: [],
            userLocaIds: [],
            hullTypeValues: [],
            hullTypeNames: [],
            hullGrades: [],
            hullFactionValues: [],
            fleetTypeValues: [],
            fleetTypeNames: [],
            evidenceTier: "tier2_view_adjacent_ui",
            passiveSightingCount: 0,
            supplementalSightingCount: 0,
            sourceCoverage: createSourceCoverageAccumulator(),
            latestObservation: null,
            baseline: null,
        };

        group.firstSeenAt = olderTimestamp(group.firstSeenAt, event.timestamp);
        group.lastSeenAt = newerTimestamp(group.lastSeenAt, event.timestamp);
        group.sightingCount += 1;
        group.strongestConfidence = strongerConfidence(group.strongestConfidence, asText(observation.confidence));
        addUnique(group.sourceSurfaces, asText(observation.sourceSurface));
        addUnique(group.hullIds, asText(observation.hullId));
        addUnique(group.hullNames, asText(observation.hullName));
        addUnique(group.runtimeFleetIds, asText(observation.runtimeFleetId));
        addUnique(group.locationTranslationIds, asText(observation.locationTranslationId));
        addUnique(group.userIds, asText(observation.userId));
        addUnique(group.systemIds, asText(observation.systemId));
        addUniqueInteger(group.userLevels, finiteIntegerOrNull(observation.userLevel));
        addUnique(group.userLocaIds, asText(observation.userLocaId));
        addUniqueInteger(group.hullTypeValues, finiteIntegerOrNull(observation.hullTypeValue));
        addUnique(group.hullTypeNames, asText(observation.hullTypeName));
        addUniqueInteger(group.hullGrades, finiteIntegerOrNull(observation.hullGrade));
        addUniqueInteger(group.hullFactionValues, finiteIntegerOrNull(observation.hullFactionValue));
        addUniqueInteger(group.fleetTypeValues, finiteIntegerOrNull(observation.fleetTypeValue));
        addUnique(group.fleetTypeNames, asText(observation.fleetTypeName));
        const sourceSurface = observedHostileSourceSurfaceInfo(observation.sourceSurface);
        appendSourceCoverage(group.sourceCoverage, sourceSurface);
        if (sourceSurface.countBehavior === "passive") {
            group.passiveSightingCount += 1;
        } else if (sourceSurface.countBehavior === "supplemental") {
            group.supplementalSightingCount += 1;
        }

        const latestTimestamp = group.latestObservation?.timestamp ?? "";
        if (!latestTimestamp || newerTimestamp(latestTimestamp, event.timestamp) === event.timestamp) {
            group.latestObservation = {
                timestamp: event.timestamp ?? null,
                sourceSurface: asText(observation.sourceSurface) || null,
                sourceTier: sourceSurface.tier,
                confidence: asText(observation.confidence) || null,
                runtimeFleetId: asText(observation.runtimeFleetId) || null,
                hullId: asText(observation.hullId) || null,
                hullName: asText(observation.hullName) || null,
                threatLevel: finiteNumberOrNull(observation.threatLevel),
                locationTranslationId: asText(observation.locationTranslationId) || null,
                userId: asText(observation.userId) || null,
                systemId: asText(observation.systemId) || null,
                userLevel: finiteIntegerOrNull(observation.userLevel),
                userLocaId: asText(observation.userLocaId) || null,
                hullTypeValue: finiteIntegerOrNull(observation.hullTypeValue),
                hullTypeName: asText(observation.hullTypeName) || null,
                hullGrade: finiteIntegerOrNull(observation.hullGrade),
                hullFactionValue: finiteIntegerOrNull(observation.hullFactionValue),
                fleetTypeValue: finiteIntegerOrNull(observation.fleetTypeValue),
                fleetTypeName: asText(observation.fleetTypeName) || null,
            };
        }

        groups.set(identity.key, group);
    }

    return [...groups.values()]
        .sort(compareObservedHostileGroups)
        .map((group) => {
            const baseline = matchObservedHostileReference(group, options.referenceCatalog ?? null);
            const referencePresence = referencePresenceFromBaseline(baseline);
            return {
                ...group,
                evidenceTier: observedHostileEvidenceTier(group),
                sourceCoverage: finalizeSourceCoverage(group.sourceCoverage),
                baseline,
                referencePresence,
                matchHealthStatus: matchHealthStatusFromBaseline(baseline),
            };
        });
}

function isObservedHostileEvent(entry) {
    if (!entry?.parsed || entry?.event?.type !== OBSERVED_HOSTILE_EVENT_TYPE) {
        return false;
    }

    return true;
}

function isCatalogObservedHostileEntry(entry) {
    if (!isObservedHostileEvent(entry)) {
        return false;
    }

    const sourceSurface = observedHostileSourceSurfaceInfo(asRecord(entry.event.observation).sourceSurface);
    return sourceSurface.includeInCatalog === true;
}

function compareObservedHostileGroups(left, right) {
    const rightSeen = parseInstantMs(right.lastSeenAt);
    const leftSeen = parseInstantMs(left.lastSeenAt);
    if (rightSeen != null && leftSeen != null && rightSeen !== leftSeen) {
        return rightSeen - leftSeen;
    }

    return String(left.key).localeCompare(String(right.key));
}

function buildObservedHostileSightings(entries = []) {
    const sightings = [];
    for (const entry of entries) {
        if (!isCatalogObservedHostileEntry(entry)) {
            continue;
        }

        const event = entry.event;
        const observation = asRecord(event.observation);
        const timestamp = asText(event.timestamp);
        const timestampMs = parseInstantMs(timestamp);
        if (timestampMs == null) {
            continue;
        }
        const sourceSurface = observedHostileSourceSurfaceInfo(observation.sourceSurface);

        sightings.push({
            lineNumber: Number.isFinite(entry.lineNumber) ? entry.lineNumber : null,
            timestamp,
            timestampMs,
            entryKey: deriveObservedHostileIdentity(observation).key,
            sourceSurface: sourceSurface.surface || null,
            sourceTier: sourceSurface.tier,
            countBehavior: sourceSurface.countBehavior,
            systemId: asText(observation.systemId) || null,
        });
    }

    return sightings.sort(compareSightingsAscending);
}

function buildSystemObservations(sightings, entryByKey, options = {}) {
    const windowMs = normalizeObservationWindowMs(options.windowMs);
    const windows = [];
    let current = null;

    for (const sighting of sightings) {
        if (!current || shouldStartObservationWindow(current, sighting, windowMs)) {
            finishSystemObservation(windows, current, entryByKey, windowMs);
            current = createSystemObservationAccumulator(sighting);
            continue;
        }

        appendSightingToSystemObservation(current, sighting);
    }

    finishSystemObservation(windows, current, entryByKey, windowMs);
    return windows.sort(compareSystemObservations);
}

function createSystemObservationAccumulator(sighting) {
    const window = {
        startedAt: sighting.timestamp,
        endedAt: sighting.timestamp,
        startedAtMs: sighting.timestampMs,
        endedAtMs: sighting.timestampMs,
        firstLineNumber: sighting.lineNumber,
        lastLineNumber: sighting.lineNumber,
        systemId: sighting.systemId,
        systemIdSource: sighting.systemId ? "observed_in_window" : "unknown",
        surfaces: [],
        entryKeys: [],
        passiveEntryKeys: [],
        supplementalEntryKeys: [],
        sightingCount: 0,
        rawEventCount: 0,
        passiveSightingCount: 0,
        passiveRawEventCount: 0,
        supplementalSightingCount: 0,
        supplementalRawEventCount: 0,
        totalSightingCount: 0,
        totalRawEventCount: 0,
        sourceCoverage: createSourceCoverageAccumulator(),
    };
    appendSightingToSystemObservation(window, sighting);
    return window;
}

function finishSystemObservation(windows, window, entryByKey, windowMs) {
    if (!window) {
        return;
    }

    const passiveEntries = window.passiveEntryKeys
        .map((key) => entryByKey.get(key))
        .filter(Boolean)
        .sort(compareObservedHostileGroups);
    if (passiveEntries.length === 0) {
        return;
    }
    const supplementalEntries = window.supplementalEntryKeys
        .filter((key) => !window.passiveEntryKeys.includes(key))
        .map((key) => entryByKey.get(key))
        .filter(Boolean)
        .sort(compareObservedHostileGroups);
    const referencePresence = passiveEntries.reduce((summary, entry) => {
        switch (entry.referencePresence) {
            case "known":
                summary.known += 1;
                break;
            case "unknown":
                summary.unknown += 1;
                break;
            case "needs_signal":
                summary.needsSignal += 1;
                break;
            default:
                summary.unavailable += 1;
                break;
        }
        return summary;
    }, { known: 0, unknown: 0, needsSignal: 0, unavailable: 0 });
    const matchHealth = passiveEntries.reduce((summary, entry) => {
        switch (entry.matchHealthStatus) {
            case "matched":
                summary.matched += 1;
                break;
            case "candidate":
                summary.candidate += 1;
                break;
            case "ambiguous":
                summary.ambiguous += 1;
                break;
            case "unmapped":
                summary.unmapped += 1;
                break;
            default:
                summary.insufficientSignal += 1;
                break;
        }
        return summary;
    }, { matched: 0, candidate: 0, ambiguous: 0, unmapped: 0, insufficientSignal: 0 });
    const systemId = window.systemId || null;
    const observationId = [
        "observation",
        systemId || "unknown-system",
        window.firstLineNumber ?? window.startedAtMs,
        window.lastLineNumber ?? window.endedAtMs,
    ].map((part) => encodeURIComponent(String(part))).join(":");
    const sourceCoverage = finalizeSourceCoverage(window.sourceCoverage);

    windows.push({
        observationId,
        systemId,
        systemName: null,
        systemIdSource: window.systemIdSource,
        startedAt: window.startedAt,
        endedAt: window.endedAt,
        windowMs,
        surfaces: sourceCoverage.surfaces,
        sourceCoverage,
        rawEventCount: window.passiveRawEventCount,
        sightingCount: window.passiveSightingCount,
        supplementalRawEventCount: window.supplementalRawEventCount,
        supplementalSightingCount: window.supplementalSightingCount,
        totalRawEventCount: window.totalRawEventCount,
        totalSightingCount: window.totalSightingCount,
        observedHostileCount: passiveEntries.length,
        passiveObservedHostileCount: passiveEntries.length,
        supplementalObservedHostileCount: supplementalEntries.length,
        totalObservedHostileCount: passiveEntries.length + supplementalEntries.length,
        referencePresence,
        matchHealth,
        entryKeys: window.passiveEntryKeys,
        entries: passiveEntries,
        supplementalEntryKeys: supplementalEntries.map((entry) => entry.key),
        supplementalEntries,
    });
}

function appendSightingToSystemObservation(window, sighting) {
    window.endedAt = sighting.timestamp;
    window.endedAtMs = sighting.timestampMs;
    window.lastLineNumber = sighting.lineNumber ?? window.lastLineNumber;
    if (!window.systemId && sighting.systemId) {
        window.systemId = sighting.systemId;
        window.systemIdSource = "observed_in_window";
    }
    addUnique(window.surfaces, sighting.sourceSurface);
    addUnique(window.entryKeys, sighting.entryKey);
    window.totalSightingCount += 1;
    window.totalRawEventCount += 1;
    appendSourceCoverage(window.sourceCoverage, observedHostileSourceSurfaceInfo(sighting.sourceSurface));
    switch (sighting.countBehavior) {
        case "passive":
            addUnique(window.passiveEntryKeys, sighting.entryKey);
            window.passiveSightingCount += 1;
            window.passiveRawEventCount += 1;
            break;
        case "supplemental":
            addUnique(window.supplementalEntryKeys, sighting.entryKey);
            window.supplementalSightingCount += 1;
            window.supplementalRawEventCount += 1;
            break;
        default:
            break;
    }
    window.sightingCount = window.passiveSightingCount;
    window.rawEventCount = window.passiveRawEventCount;
}

function shouldStartObservationWindow(window, sighting, windowMs) {
    const gapMs = sighting.timestampMs - window.endedAtMs;
    const knownSystemChanged = window.systemId && sighting.systemId && window.systemId !== sighting.systemId;
    return gapMs > windowMs || knownSystemChanged;
}

function compareSightingsAscending(left, right) {
    if (left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
    }
    return (left.lineNumber ?? 0) - (right.lineNumber ?? 0);
}

function compareSystemObservations(left, right) {
    const rightEnded = parseInstantMs(right.endedAt);
    const leftEnded = parseInstantMs(left.endedAt);
    if (rightEnded != null && leftEnded != null && rightEnded !== leftEnded) {
        return rightEnded - leftEnded;
    }

    return String(left.observationId).localeCompare(String(right.observationId));
}

function filterObservedHostileCatalogEntries(entries, options = {}) {
    const status = normalizeStatusFilter(options.status);
    const reference = normalizeReferencePresenceFilter(options.reference);
    const systemId = asText(options.systemId);
    const query = normalizeSearchText(options.q);
    return entries.filter((entry) => {
        if (status && entry.matchHealthStatus !== status) {
            return false;
        }
        if (reference && entry.referencePresence !== reference) {
            return false;
        }
        if (systemId && !entryMatchesSystem(entry, systemId)) {
            return false;
        }
        if (query && !normalizeSearchText(catalogEntrySearchText(entry)).includes(query)) {
            return false;
        }
        return true;
    });
}

function filterSystemObservations(observations, options = {}) {
    const status = normalizeStatusFilter(options.status);
    const reference = normalizeReferencePresenceFilter(options.reference);
    const systemId = asText(options.systemId);
    const query = normalizeSearchText(options.q);
    return observations.filter((observation) => {
        if (status && observationMatchHealthCount(observation, status) <= 0) {
            return false;
        }
        if (reference && observationReferencePresenceCount(observation, reference) <= 0) {
            return false;
        }
        if (systemId && observation.systemId !== systemId) {
            return false;
        }
        if (query && !normalizeSearchText(systemObservationSearchText(observation)).includes(query)) {
            return false;
        }
        return true;
    });
}

function paginateItems(items, options, cursorForItem) {
    const limit = normalizePageLimit(options.limit);
    const cursor = decodeCursor(options.cursor);
    const startIndex = cursor ? cursorStartIndex(items, cursor, cursorForItem) : 0;
    const pageItems = items.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + pageItems.length < items.length;

    return {
        items: pageItems,
        hasMore,
        nextCursor: hasMore && pageItems.length > 0 ? encodeCursor(cursorForItem(pageItems.at(-1))) : null,
    };
}

function cursorStartIndex(items, cursor, cursorForItem) {
    const exactIndex = items.findIndex((item) => cursorMatches(cursorForItem(item), cursor));
    if (exactIndex >= 0) {
        return exactIndex + 1;
    }

    const afterIndex = items.findIndex((item) => cursorSortsAfter(cursorForItem(item), cursor));
    return afterIndex >= 0 ? afterIndex : items.length;
}

function catalogEntryCursor(entry) {
    return {
        sort: "latest_seen_desc",
        timeMs: parseInstantMs(entry?.lastSeenAt) ?? 0,
        key: String(entry?.key ?? ""),
    };
}

function observationCursor(observation) {
    return {
        sort: "latest_seen_desc",
        timeMs: parseInstantMs(observation?.endedAt) ?? 0,
        key: String(observation?.observationId ?? ""),
    };
}

function cursorMatches(left, right) {
    return left?.sort === right?.sort && left?.timeMs === right?.timeMs && left?.key === right?.key;
}

function cursorSortsAfter(itemCursor, decodedCursor) {
    if (itemCursor?.sort !== decodedCursor?.sort) {
        return false;
    }
    if (itemCursor.timeMs !== decodedCursor.timeMs) {
        return itemCursor.timeMs < decodedCursor.timeMs;
    }
    return String(itemCursor.key).localeCompare(String(decodedCursor.key)) > 0;
}

function encodeCursor(cursor) {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
    const normalized = asText(cursor);
    if (!normalized) {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(normalized, "base64url").toString("utf8"));
        return typeof decoded === "object" && decoded !== null ? decoded : null;
    } catch {
        return null;
    }
}

function catalogEntrySearchText(entry) {
    const latest = asRecord(entry?.latestObservation);
    return [
        entry?.title,
        entry?.key,
        entry?.identityKind,
        entry?.identityQuality,
        entry?.referencePresence,
        entry?.strongestConfidence,
        entry?.matchHealthStatus,
        ...(Array.isArray(entry?.sourceSurfaces) ? entry.sourceSurfaces : []),
        ...(Array.isArray(entry?.hullIds) ? entry.hullIds : []),
        ...(Array.isArray(entry?.hullNames) ? entry.hullNames : []),
        ...(Array.isArray(entry?.runtimeFleetIds) ? entry.runtimeFleetIds : []),
        ...(Array.isArray(entry?.locationTranslationIds) ? entry.locationTranslationIds : []),
        ...(Array.isArray(entry?.userIds) ? entry.userIds : []),
        ...(Array.isArray(entry?.systemIds) ? entry.systemIds : []),
        ...(Array.isArray(entry?.userLevels) ? entry.userLevels : []),
        ...(Array.isArray(entry?.userLocaIds) ? entry.userLocaIds : []),
        ...(Array.isArray(entry?.hullTypeNames) ? entry.hullTypeNames : []),
        ...(Array.isArray(entry?.fleetTypeNames) ? entry.fleetTypeNames : []),
        latest.sourceSurface,
        latest.sourceTier,
        latest.runtimeFleetId,
        latest.hullId,
        latest.hullName,
        latest.locationTranslationId,
        latest.userId,
        latest.systemId,
        latest.hullTypeName,
        latest.fleetTypeName,
        entry?.baseline?.summary,
        ...(Array.isArray(entry?.baseline?.matches) ? entry.baseline.matches.flatMap((match) => [
            match?.hostileId,
            match?.name,
            match?.factionName,
        ]) : []),
    ].filter(Boolean).join(" ");
}

function systemObservationSearchText(observation) {
    return [
        observation?.observationId,
        observation?.systemId,
        observation?.systemName,
        observation?.systemId ? `System ${observation.systemId}` : "Unknown system",
        ...(Object.entries(asRecord(observation?.referencePresence)).map(([key, value]) => `${key}:${value}`)),
        ...(Array.isArray(observation?.surfaces) ? observation.surfaces : []),
        ...(Array.isArray(observation?.entries) ? observation.entries.map(catalogEntrySearchText) : []),
        ...(Array.isArray(observation?.supplementalEntries)
            ? observation.supplementalEntries.map(catalogEntrySearchText)
            : []),
    ].filter(Boolean).join(" ");
}

function entryMatchesSystem(entry, systemId) {
    return (Array.isArray(entry?.systemIds) && entry.systemIds.includes(systemId))
        || asText(entry?.latestObservation?.systemId) === systemId;
}

function observationMatchHealthCount(observation, status) {
    const health = asRecord(observation?.matchHealth);
    switch (status) {
        case "matched":
            return finiteIntegerOrNull(health.matched) ?? 0;
        case "candidate":
            return finiteIntegerOrNull(health.candidate) ?? 0;
        case "ambiguous":
            return finiteIntegerOrNull(health.ambiguous) ?? 0;
        case "unmapped":
            return finiteIntegerOrNull(health.unmapped) ?? 0;
        case "insufficient_signal":
            return finiteIntegerOrNull(health.insufficientSignal) ?? 0;
        default:
            return 0;
    }
}

function observationReferencePresenceCount(observation, reference) {
    const presence = asRecord(observation?.referencePresence);
    switch (reference) {
        case "known":
            return finiteIntegerOrNull(presence.known) ?? 0;
        case "unknown":
            return finiteIntegerOrNull(presence.unknown) ?? 0;
        case "needs_signal":
            return finiteIntegerOrNull(presence.needsSignal) ?? 0;
        case "unavailable":
            return finiteIntegerOrNull(presence.unavailable) ?? 0;
        default:
            return 0;
    }
}

function matchHealthStatusFromBaseline(baseline) {
    switch (String(baseline?.status ?? "").trim().toLowerCase()) {
        case "matched":
            return "matched";
        case "candidate":
            return "candidate";
        case "ambiguous":
            return "ambiguous";
        case "unmapped":
            return "unmapped";
        default:
            return "insufficient_signal";
    }
}

function referencePresenceFromBaseline(baseline) {
    switch (String(baseline?.status ?? "").trim().toLowerCase()) {
        case "matched":
        case "candidate":
        case "ambiguous":
            return "known";
        case "unmapped":
            return "unknown";
        case "insufficient_signal":
            return "needs_signal";
        default:
            return "unavailable";
    }
}

function observedHostileEvidenceTier(group) {
    if ((group?.passiveSightingCount ?? 0) > 0) {
        return "tier1_passive_system_view";
    }
    if ((group?.supplementalSightingCount ?? 0) > 0) {
        return "tier2_view_adjacent_ui";
    }
    return "tier3_interactive";
}

function normalizeStatusFilter(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
    if (!normalized || normalized === "all") {
        return "";
    }
    if (normalized === "insufficientsignal") {
        return "insufficient_signal";
    }
    return ["matched", "candidate", "ambiguous", "unmapped", "insufficient_signal"].includes(normalized) ? normalized : "";
}

function normalizeReferencePresenceFilter(value) {
    const normalized = String(value ?? "").trim().toLowerCase().replaceAll("-", "_");
    if (!normalized || normalized === "all") {
        return "";
    }
    if (normalized === "needssignal" || normalized === "insufficientsignal") {
        return "needs_signal";
    }
    return ["known", "unknown", "needs_signal", "unavailable"].includes(normalized) ? normalized : "";
}

function normalizeSearchText(value) {
    return String(value ?? "").trim().toLowerCase();
}

function normalizePageLimit(value) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    const limit = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_PAGE_LIMIT;
    return Math.min(Math.max(limit, 1), MAX_PAGE_LIMIT);
}

function normalizeObservationWindowMs(value) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    const windowMs = Number.isFinite(parsed) ? Math.trunc(parsed) : DEFAULT_OBSERVATION_WINDOW_MS;
    return Math.min(Math.max(windowMs, 10 * 1000), 5 * 60 * 1000);
}

function observedHostileSourceSurfaceCatalog() {
    return OBSERVED_HOSTILE_SOURCE_SURFACE_CATALOG.map((surface) => ({ ...surface }));
}

function observedHostileSourceSurfaceInfo(surface) {
    const normalized = asText(surface);
    const known = OBSERVED_HOSTILE_SOURCE_SURFACES[normalized];
    if (known) {
        return known;
    }

    return {
        surface: normalized || "unknown",
        tier: "unclassified",
        tierLabel: "Unclassified",
        countBehavior: "debug_only",
        includeInCatalog: false,
        description: normalized
            ? `Observed hostile source surface '${normalized}' is not yet classified for catalog counts.`
            : "Observed hostile source surface is unavailable.",
    };
}

function createSourceCoverageAccumulator() {
    return {
        surfaces: [],
        passiveSurfaces: [],
        supplementalSurfaces: [],
        ignoredSurfaces: [],
        passiveEventCount: 0,
        supplementalEventCount: 0,
        ignoredEventCount: 0,
    };
}

function appendSourceCoverage(coverage, sourceSurface) {
    if (!coverage || !sourceSurface) {
        return;
    }

    addUnique(coverage.surfaces, sourceSurface.surface);
    switch (sourceSurface.countBehavior) {
        case "passive":
            coverage.passiveEventCount += 1;
            addUnique(coverage.passiveSurfaces, sourceSurface.surface);
            break;
        case "supplemental":
            coverage.supplementalEventCount += 1;
            addUnique(coverage.supplementalSurfaces, sourceSurface.surface);
            break;
        default:
            coverage.ignoredEventCount += 1;
            addUnique(coverage.ignoredSurfaces, sourceSurface.surface);
            break;
    }
}

function finalizeSourceCoverage(coverage) {
    const normalized = coverage ?? createSourceCoverageAccumulator();
    return {
        surfaces: [...normalized.surfaces],
        passive: {
            surfaces: [...normalized.passiveSurfaces],
            eventCount: normalized.passiveEventCount,
        },
        supplemental: {
            surfaces: [...normalized.supplementalSurfaces],
            eventCount: normalized.supplementalEventCount,
        },
        ignored: {
            surfaces: [...normalized.ignoredSurfaces],
            eventCount: normalized.ignoredEventCount,
        },
    };
}

function buildObservedHostileSourceCoverage(entries = []) {
    const coverage = createSourceCoverageAccumulator();
    for (const entry of entries) {
        if (!isObservedHostileEvent(entry)) {
            continue;
        }

        const observation = asRecord(entry.event.observation);
        appendSourceCoverage(coverage, observedHostileSourceSurfaceInfo(observation.sourceSurface));
    }

    return finalizeSourceCoverage(coverage);
}

function deriveObservedHostileIdentity(observation) {
    const hullId = asText(observation.hullId);
    if (hullId) {
        return { key: `hull:${hullId}`, kind: "hull_id", quality: "coarse_shared" };
    }

    const userId = asText(observation.userId);
    if (userId) {
        return { key: `user:${userId}`, kind: "user_id", quality: "candidate_game_identity" };
    }

    const locationTranslationId = asText(observation.locationTranslationId);
    if (locationTranslationId) {
        return { key: `loca:${locationTranslationId}`, kind: "location_translation_id", quality: "coarse_label" };
    }

    const hullName = asText(observation.hullName);
    if (hullName) {
        return { key: `hull_name:${hullName.toLowerCase()}`, kind: "hull_name", quality: "coarse_label" };
    }

    const runtimeFleetId = asText(observation.runtimeFleetId);
    if (runtimeFleetId) {
        return { key: `runtime:${runtimeFleetId}`, kind: "runtime_fleet_id", quality: "transient_runtime" };
    }

    const poiPointer = asText(observation.poiPointer);
    if (poiPointer) {
        return { key: `poi:${poiPointer}`, kind: "poi_pointer", quality: "process_local" };
    }

    return { key: "unknown:unkeyed", kind: "unknown", quality: "opaque" };
}

function observedHostileTitle(observation, identity) {
    return asText(observation.hullName)
        || asText(observation.userId)
        || asText(observation.runtimeFleetId)
        || identity.key;
}

function strongerConfidence(current, candidate) {
    if (!candidate) {
        return current ?? null;
    }

    const rank = confidenceRank(candidate);
    const currentRank = confidenceRank(current ?? "");
    return rank >= currentRank ? candidate : current;
}

function confidenceRank(value) {
    switch (String(value ?? "").trim()) {
        case "strong":
            return 3;
        case "candidate-high":
            return 2;
        case "candidate":
            return 1;
        default:
            return 0;
    }
}

function olderTimestamp(current, candidate) {
    if (!candidate) {
        return current ?? null;
    }
    if (!current) {
        return candidate;
    }

    const currentMs = parseInstantMs(current);
    const candidateMs = parseInstantMs(candidate);
    if (currentMs == null || candidateMs == null) {
        return current;
    }
    return candidateMs < currentMs ? candidate : current;
}

function newerTimestamp(current, candidate) {
    if (!candidate) {
        return current ?? null;
    }
    if (!current) {
        return candidate;
    }

    const currentMs = parseInstantMs(current);
    const candidateMs = parseInstantMs(candidate);
    if (currentMs == null) {
        return candidate;
    }
    if (candidateMs == null) {
        return current;
    }
    return candidateMs >= currentMs ? candidate : current;
}

function parseInstantMs(value) {
    const normalized = asText(value);
    if (!normalized) {
        return null;
    }

    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
}

function addUnique(items, value) {
    if (value && !items.includes(value)) {
        items.push(value);
    }
}

function finiteNumberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteIntegerOrNull(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }

    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asText(value) {
    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return `${Math.trunc(value)}`;
    }

    return "";
}

function addUniqueInteger(items, value) {
    if (value != null && !items.includes(value)) {
        items.push(value);
    }
}

function resolvedObservedHostileSource(snapshot = {}) {
    return typeof snapshot.source === "string" && snapshot.source.trim()
        ? snapshot.source.trim()
        : "store";
}
