const OBSERVED_HOSTILE_EVENT_TYPE = "observed.hostile";

export function buildObservedHostileCatalogSnapshot(snapshot = {}, options = {}) {
    const entries = Array.isArray(snapshot.events) ? snapshot.events : [];
    const groups = buildObservedHostileGroups(entries);
    const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : groups.length;
    const limitedEntries = groups.slice(0, limit);

    return {
        ok: snapshot.ok !== false,
        source: resolvedObservedHostileSource(snapshot),
        storageBackend: snapshot.storageBackend ?? null,
        exists: snapshot.exists !== false,
        detail: "observed-hostile-index",
        generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        pollHintMs: snapshot.pollHintMs,
        totalEvents: snapshot.totalLines ?? entries.length,
        scannedEvents: entries.length,
        totalEntries: groups.length,
        returnedEntries: limitedEntries.length,
        probeStatus: options.probeStatus ?? null,
        entries: limitedEntries,
        error: snapshot.ok === false ? snapshot.error ?? "Observed hostile catalog unavailable" : undefined,
    };
}

export function buildObservedHostileGroups(entries = []) {
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
            latestObservation: null,
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

        const latestTimestamp = group.latestObservation?.timestamp ?? "";
        if (!latestTimestamp || newerTimestamp(latestTimestamp, event.timestamp) === event.timestamp) {
            group.latestObservation = {
                timestamp: event.timestamp ?? null,
                sourceSurface: asText(observation.sourceSurface) || null,
                confidence: asText(observation.confidence) || null,
                runtimeFleetId: asText(observation.runtimeFleetId) || null,
                hullId: asText(observation.hullId) || null,
                hullName: asText(observation.hullName) || null,
                threatLevel: finiteNumberOrNull(observation.threatLevel),
                locationTranslationId: asText(observation.locationTranslationId) || null,
                userId: asText(observation.userId) || null,
            };
        }

        groups.set(identity.key, group);
    }

    return [...groups.values()].sort(compareObservedHostileGroups);
}

function compareObservedHostileGroups(left, right) {
    const rightSeen = parseInstantMs(right.lastSeenAt);
    const leftSeen = parseInstantMs(left.lastSeenAt);
    if (rightSeen != null && leftSeen != null && rightSeen !== leftSeen) {
        return rightSeen - leftSeen;
    }

    if (right.sightingCount !== left.sightingCount) {
        return right.sightingCount - left.sightingCount;
    }

    return String(left.key).localeCompare(String(right.key));
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

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asText(value) {
    return typeof value === "string" ? value.trim() : "";
}

function resolvedObservedHostileSource(snapshot = {}) {
    return typeof snapshot.source === "string" && snapshot.source.trim()
        ? snapshot.source.trim()
        : "store";
}
