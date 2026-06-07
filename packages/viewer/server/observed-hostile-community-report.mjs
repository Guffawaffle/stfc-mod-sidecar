import {
    buildObservedHostileCatalogEntriesProjection,
    deriveObservedHostileIdentity,
    observedHostileSourceSurfaceInfo,
} from "./observed-hostile-access.mjs";

export const OBSERVED_HOSTILE_COMMUNITY_REPORT_PROTOCOL_VERSION = "stfc.observed-hostile.community-report.v1";

const OBSERVED_HOSTILE_EVENT_TYPE = "observed.hostile";
const HIGH_CONFIDENCE_EVIDENCE_LABEL = "high_confidence_passive_observation";
const PASSIVE_SOURCE_SURFACE = "fleet_data_system";
const REPORT_OBSERVATION_WINDOW_MS = 5 * 60 * 1000;
const STABLE_IDENTITY_KINDS = new Set(["hull_id", "hull_name"]);
const SUBMISSION_READINESS = Object.freeze({
    ready: "submission_ready",
    maintainerReview: "ready_for_maintainer_review",
    review: "needs_identifier_review",
});
const ACCEPTED_SUBMISSION_IDENTIFIER_FIELDS = Object.freeze(["hullId"]);
const MAINTAINER_REVIEW_IDENTIFIER_FIELDS = Object.freeze(["userLocaId"]);
const HULL_TYPE_TOKENS = new Map([
    ["battleship", "Battleship"],
    ["destroyer", "Destroyer"],
    ["explorer", "Explorer"],
    ["interceptor", "Interceptor"],
    ["survey", "Survey"],
]);
const FACTION_TOKENS = new Map([
    ["fed", "Federation"],
    ["federation", "Federation"],
    ["klg", "Klingon"],
    ["kli", "Klingon"],
    ["kling", "Klingon"],
    ["klingon", "Klingon"],
    ["rom", "Romulan"],
    ["romulan", "Romulan"],
    ["dom", "Dominion"],
    ["dominion", "Dominion"],
]);

export function buildObservedHostileCommunityReport(snapshot = {}, options = {}) {
    const projection = buildObservedHostileCatalogEntriesProjection(snapshot, {
        referenceCatalog: options.referenceCatalog ?? null,
    });
    const evidenceByKey = buildCommunityReportEvidenceByKey(snapshot);
    const summary = createCommunityReportSummary();
    const items = [];

    for (const entry of Array.isArray(projection.entries) ? projection.entries : []) {
        const status = normalizedMatchHealthStatus(entry);
        switch (status) {
            case "matched":
                summary.excludedMatchedCount += 1;
                continue;
            case "candidate":
                summary.excludedCandidateCount += 1;
                continue;
            case "ambiguous":
                summary.excludedAmbiguousCount += 1;
                continue;
            case "unmapped":
                break;
            default:
                summary.excludedInsufficientSignalCount += 1;
                continue;
        }

        const gate = highConfidenceUntrackedHostileGate(entry);
        if (!gate.include) {
            summary.excludedUnmappedLowEvidenceCount += 1;
            continue;
        }

        const item = communityReportItemFromEntry(entry, gate, evidenceByKey.get(asText(entry.key)));
        items.push(item);
        if (item.identity.submissionReadiness === SUBMISSION_READINESS.ready) {
            summary.submissionReadyCount += 1;
        } else if (item.identity.submissionReadiness === SUBMISSION_READINESS.maintainerReview) {
            summary.readyForMaintainerReviewCount += 1;
        } else {
            summary.needsIdentifierReviewCount += 1;
        }
    }

    items.sort(compareCommunityReportItems);
    summary.highConfidenceUntrackedCount = items.length;

    return {
        ok: projection.ok,
        protocolVersion: OBSERVED_HOSTILE_COMMUNITY_REPORT_PROTOCOL_VERSION,
        generatedAt: reportGeneratedAt(options),
        reference: communityReportReference(projection.referenceCatalog),
        summary,
        items,
        error: projection.ok === false ? projection.error ?? "Observed hostile community report unavailable" : undefined,
    };
}

export function formatObservedHostileCommunityReportMarkdown(report = {}) {
    const summary = asRecord(report.summary);
    const reference = asRecord(report.reference);
    const items = Array.isArray(report.items) ? [...report.items].sort(compareCommunityReportItems) : [];
    const submissionReadyItems = items.filter((item) => submissionReadinessForItem(item) === SUBMISSION_READINESS.ready);
    const maintainerReviewItems = items.filter((item) => submissionReadinessForItem(item) === SUBMISSION_READINESS.maintainerReview);
    const reviewOnlyItems = items.filter((item) => submissionReadinessForItem(item) === SUBMISSION_READINESS.review);
    const lines = [
        "# Observed Hostile Community Report",
        "",
        `Reference: ${markdownText(reference.label || reference.source || "Unavailable")}`,
        `Generated: ${markdownText(report.generatedAt || "Unknown")}`,
        "",
        "## Summary",
        "",
        `* Submission-ready unmapped with hullId: ${Number(summary.submissionReadyCount ?? 0)}`,
        `* Ready for maintainer review without hullId: ${Number(summary.readyForMaintainerReviewCount ?? 0)}`,
        `* Needs identifier review: ${Number(summary.needsIdentifierReviewCount ?? 0)}`,
        "",
        "userLocaId is included below only as a maintainer-review identifier. It is not treated here as an accepted unique hostile id, and it can repeat across multiple level variants.",
        "",
    ];

    renderMarkdownSection(
        lines,
        "## Submission-ready unmapped hostiles",
        "No submission-ready unmapped hostiles found.",
        submissionReadyItems,
    );
    renderMarkdownSection(
        lines,
        "## High-confidence unmapped hostiles ready for maintainer review",
        "No high-confidence unmapped hostiles are currently ready for maintainer review.",
        maintainerReviewItems,
    );
    renderMarkdownSection(
        lines,
        "## Unmapped observations needing identifier review",
        "No high-confidence unmapped observations currently need identifier review.",
        reviewOnlyItems,
    );

    lines.push("## Coverage", "");
    lines.push(`* Included high-confidence unmapped: ${Number(summary.highConfidenceUntrackedCount ?? 0)}`);
    lines.push(`* Submission-ready: ${Number(summary.submissionReadyCount ?? 0)}`);
    lines.push(`* Ready for maintainer review: ${Number(summary.readyForMaintainerReviewCount ?? 0)}`);
    lines.push(`* Needs identifier review: ${Number(summary.needsIdentifierReviewCount ?? 0)}`);
    lines.push(`* Excluded matched: ${Number(summary.excludedMatchedCount ?? 0)}`);
    lines.push(`* Excluded candidate: ${Number(summary.excludedCandidateCount ?? 0)}`);
    lines.push(`* Excluded ambiguous: ${Number(summary.excludedAmbiguousCount ?? 0)}`);
    lines.push(`* Excluded insufficient signal: ${Number(summary.excludedInsufficientSignalCount ?? 0)}`);
    lines.push(`* Excluded unmapped below evidence gate: ${Number(summary.excludedUnmappedLowEvidenceCount ?? 0)}`);
    lines.push("");

    return `${lines.join("\n").trimEnd()}\n`;
}

export function highConfidenceUntrackedHostileGate(entry = {}) {
    const reasons = [];
    const status = normalizedMatchHealthStatus(entry);
    const latest = asRecord(entry.latestObservation);
    const hullName = primaryText([latest.hullName, ...(Array.isArray(entry.hullNames) ? entry.hullNames : [])]);
    const hullSignals = hullSignalsForEntry(entry);
    const systemId = primaryText([latest.systemId, ...(Array.isArray(entry.systemIds) ? entry.systemIds : [])]);
    const level = levelForEntry(entry, hullSignals);
    const passiveSightingCount = finiteIntegerOrNull(entry.passiveSightingCount);
    const sightingCount = finiteIntegerOrNull(entry.sightingCount);

    if (status !== "unmapped" || normalizedBaselineStatus(entry.baseline) !== "unmapped") {
        reasons.push("baseline_status_not_unmapped");
    }
    if (!passiveSourceSurfaces(entry).includes(PASSIVE_SOURCE_SURFACE)) {
        reasons.push("missing_fleet_data_system_passive_source");
    }
    if (!hasStableObservedIdentity(entry, hullName)) {
        reasons.push("missing_stable_identity_or_hull_name");
    }
    if (!systemId) {
        reasons.push("missing_system_id");
    }
    if (level == null) {
        reasons.push("missing_level");
    }
    if (!hasMeaningfulHullSignal(entry, hullSignals)) {
        reasons.push("missing_hull_signal");
    }
    if (!Number.isInteger(passiveSightingCount) || passiveSightingCount <= 0) {
        reasons.push(Number.isInteger(sightingCount) && sightingCount > 0
            ? "missing_passive_sighting_count"
            : "missing_sighting_count");
    }

    return {
        include: reasons.length === 0,
        reasons,
        systemId: systemId || null,
        level,
        hullName: hullName || null,
        hullSignals,
    };
}

function communityReportItemFromEntry(entry, gate, evidence = {}) {
    const latest = asRecord(entry.latestObservation);
    const hullSignals = gate.hullSignals ?? hullSignalsForEntry(entry);
    const systems = buildCommunityReportSystems(entry, gate, evidence);
    const levels = uniqueIntegerList([
        gate.level,
        latest.userLevel,
        ...(Array.isArray(entry.userLevels) ? entry.userLevels : []),
    ]);
    const ids = communityReportIdsFromEntry(entry, evidence);
    const readiness = classifySubmissionReadiness(ids);
    const notes = [];

    if (levels.length > 1) {
        notes.push(`Observed with multiple levels: ${levels.join(", ")}`);
    }
    if (/wavedefense/i.test(gate.hullName ?? "")) {
        notes.push("Likely Wave Defense / inferred from hull name.");
    }

    const overallObservationCount = systems.reduce(
        (count, system) => count + (finiteIntegerOrNull(system.observationCount) ?? 0),
        0,
    );

    return {
        observedKey: asText(entry.key),
        identity: {
            kind: asText(entry.identityKind) || null,
            key: asText(entry.key) || null,
            quality: asText(entry.identityQuality) || null,
            submissionReadiness: readiness.status,
            missingFields: readiness.missingFields,
        },
        ids,
        systemId: systems.length === 1 ? systems[0].systemId : null,
        systemName: null,
        systems,
        level: gate.level,
        faction: hullSignals.faction,
        hullType: hullSignals.hullType,
        hullName: gate.hullName,
        grade: hullSignals.grade,
        sourceSurfaces: uniqueTextList(entry.sourceSurfaces),
        firstSeen: asText(entry.firstSeenAt) || null,
        lastSeen: asText(entry.lastSeenAt) || null,
        sightingCount: finiteIntegerOrNull(entry.passiveSightingCount) ?? finiteIntegerOrNull(entry.sightingCount),
        observationCount: overallObservationCount > 0 ? overallObservationCount : 1,
        baselineStatus: normalizedBaselineStatus(entry.baseline),
        baselineCandidateCount: finiteIntegerOrNull(entry.baseline?.candidateCount) ?? 0,
        evidenceConfidence: HIGH_CONFIDENCE_EVIDENCE_LABEL,
        notes,
    };
}

function buildCommunityReportEvidenceByKey(snapshot = {}) {
    const rawEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
    const evidenceByKey = new Map();

    for (const entry of rawEvents) {
        if (!isCatalogObservedHostileEvent(entry)) {
            continue;
        }

        const event = asRecord(entry.event);
        const observation = asRecord(event.observation);
        const identity = deriveObservedHostileIdentity(observation);
        const key = asText(identity.key);
        if (!key) {
            continue;
        }

        const evidence = evidenceByKey.get(key) ?? createCommunityReportEvidenceAccumulator();
        addUnique(evidence.hullIds, asText(observation.hullId));
        addUnique(evidence.userLocaIds, asText(observation.userLocaId));
        addUnique(evidence.locationTranslationIds, asText(observation.locationTranslationId));
        addUnique(evidence.userIds, asText(observation.userId));
        addUnique(evidence.runtimeFleetIds, asText(observation.runtimeFleetId));
        addUnique(evidence.galaxyIds, asText(observation.galaxyId));
        addUnique(evidence.instanceIds, asText(observation.instanceId));

        const sourceSurface = observedHostileSourceSurfaceInfo(observation.sourceSurface);
        if (sourceSurface.countBehavior === "passive") {
            appendPassiveSystemEvidence(evidence, event.timestamp, observation, sourceSurface);
        }

        evidenceByKey.set(key, evidence);
    }

    const finalized = new Map();
    for (const [key, evidence] of evidenceByKey.entries()) {
        finalized.set(key, finalizeCommunityReportEvidence(evidence));
    }
    return finalized;
}

function createCommunityReportEvidenceAccumulator() {
    return {
        hullIds: [],
        userLocaIds: [],
        locationTranslationIds: [],
        userIds: [],
        runtimeFleetIds: [],
        galaxyIds: [],
        instanceIds: [],
        systems: new Map(),
    };
}

function appendPassiveSystemEvidence(evidence, timestamp, observation, sourceSurface) {
    const timestampText = asText(timestamp);
    const timestampMs = parseInstantMs(timestampText);
    if (!timestampText || timestampMs == null) {
        return;
    }

    const systemKey = asText(observation.systemId) || "unknown";
    const system = evidence.systems.get(systemKey) ?? {
        systemId: systemKey === "unknown" ? null : systemKey,
        firstSeen: timestampText,
        lastSeen: timestampText,
        sightingCount: 0,
        sourceSurfaces: [],
        galaxyIds: [],
        instanceIds: [],
        timestamps: [],
    };

    system.firstSeen = olderTimestamp(system.firstSeen, timestampText);
    system.lastSeen = newerTimestamp(system.lastSeen, timestampText);
    system.sightingCount += 1;
    addUnique(system.sourceSurfaces, sourceSurface.surface);
    addUnique(system.galaxyIds, asText(observation.galaxyId));
    addUnique(system.instanceIds, asText(observation.instanceId));
    system.timestamps.push(timestampMs);
    evidence.systems.set(systemKey, system);
}

function finalizeCommunityReportEvidence(evidence) {
    const systems = [...evidence.systems.values()]
        .map((system) => ({
            systemId: system.systemId,
            systemName: null,
            galaxyIds: [...system.galaxyIds],
            instanceIds: [...system.instanceIds],
            firstSeen: system.firstSeen || null,
            lastSeen: system.lastSeen || null,
            sightingCount: system.sightingCount,
            observationCount: countObservationWindows(system.timestamps),
            sourceSurfaces: [...system.sourceSurfaces],
        }))
        .sort(compareSystemEvidence);

    return {
        hullIds: [...evidence.hullIds],
        userLocaIds: [...evidence.userLocaIds],
        locationTranslationIds: [...evidence.locationTranslationIds],
        userIds: [...evidence.userIds],
        runtimeFleetIds: [...evidence.runtimeFleetIds],
        galaxyIds: [...evidence.galaxyIds],
        instanceIds: [...evidence.instanceIds],
        systems,
    };
}

function buildCommunityReportSystems(entry, gate, evidence = {}) {
    const systems = Array.isArray(evidence.systems)
        ? evidence.systems
            .filter((system) => system && (asText(system.systemId) || finiteIntegerOrNull(system.sightingCount) != null))
            .map((system) => ({
                systemId: asText(system.systemId) || null,
                systemName: null,
                galaxyIds: uniqueTextList(system.galaxyIds),
                instanceIds: uniqueTextList(system.instanceIds),
                firstSeen: asText(system.firstSeen) || null,
                lastSeen: asText(system.lastSeen) || null,
                sightingCount: finiteIntegerOrNull(system.sightingCount) ?? 0,
                observationCount: finiteIntegerOrNull(system.observationCount) ?? 0,
                sourceSurfaces: uniqueTextList(system.sourceSurfaces),
            }))
            .sort(compareSystemEvidence)
        : [];

    if (systems.length > 0) {
        return systems;
    }

    if (!gate.systemId) {
        return [];
    }

    return [{
        systemId: gate.systemId,
        systemName: null,
        galaxyIds: [],
        instanceIds: [],
        firstSeen: asText(entry.firstSeenAt) || null,
        lastSeen: asText(entry.lastSeenAt) || null,
        sightingCount: finiteIntegerOrNull(entry.passiveSightingCount) ?? finiteIntegerOrNull(entry.sightingCount) ?? 0,
        observationCount: 1,
        sourceSurfaces: passiveSourceSurfaces(entry),
    }];
}

function communityReportIdsFromEntry(entry, evidence = {}) {
    const latest = asRecord(entry.latestObservation);
    const hullIds = uniqueTextList([
        ...(Array.isArray(entry?.hullIds) ? entry.hullIds : []),
        latest.hullId,
        ...(Array.isArray(evidence?.hullIds) ? evidence.hullIds : []),
    ]);
    const userLocaIds = uniqueTextList([
        ...(Array.isArray(entry?.userLocaIds) ? entry.userLocaIds : []),
        latest.userLocaId,
        ...(Array.isArray(evidence?.userLocaIds) ? evidence.userLocaIds : []),
    ]);
    const locationTranslationIds = uniqueTextList([
        ...(Array.isArray(entry?.locationTranslationIds) ? entry.locationTranslationIds : []),
        latest.locationTranslationId,
        ...(Array.isArray(evidence?.locationTranslationIds) ? evidence.locationTranslationIds : []),
    ]);
    const userIds = uniqueTextList([
        ...(Array.isArray(entry?.userIds) ? entry.userIds : []),
        latest.userId,
        ...(Array.isArray(evidence?.userIds) ? evidence.userIds : []),
    ]);
    const runtimeFleetIds = uniqueTextList([
        ...(Array.isArray(entry?.runtimeFleetIds) ? entry.runtimeFleetIds : []),
        latest.runtimeFleetId,
        ...(Array.isArray(evidence?.runtimeFleetIds) ? evidence.runtimeFleetIds : []),
    ]);
    const galaxyIds = uniqueTextList([
        ...(Array.isArray(entry?.galaxyIds) ? entry.galaxyIds : []),
        latest.galaxyId,
        ...(Array.isArray(evidence?.galaxyIds) ? evidence.galaxyIds : []),
        ...(Array.isArray(evidence?.systems) ? evidence.systems.flatMap((system) => system?.galaxyIds ?? []) : []),
    ]);
    const instanceIds = uniqueTextList([
        ...(Array.isArray(entry?.instanceIds) ? entry.instanceIds : []),
        latest.instanceId,
        ...(Array.isArray(evidence?.instanceIds) ? evidence.instanceIds : []),
        ...(Array.isArray(evidence?.systems) ? evidence.systems.flatMap((system) => system?.instanceIds ?? []) : []),
    ]);

    return {
        hullId: hullIds[0] ?? null,
        hullIds,
        userLocaId: userLocaIds[0] ?? null,
        userLocaIds,
        locationTranslationId: locationTranslationIds[0] ?? null,
        locationTranslationIds,
        userId: userIds[0] ?? null,
        userIds,
        runtimeFleetIds,
        galaxyId: galaxyIds[0] ?? null,
        galaxyIds,
        instanceId: instanceIds[0] ?? null,
        instanceIds,
    };
}

function classifySubmissionReadiness(ids = {}) {
    if (hasIdentifierCoverage(ids, ACCEPTED_SUBMISSION_IDENTIFIER_FIELDS)) {
        return {
            status: SUBMISSION_READINESS.ready,
            missingFields: [],
        };
    }

    if (hasIdentifierCoverage(ids, MAINTAINER_REVIEW_IDENTIFIER_FIELDS)) {
        return {
            status: SUBMISSION_READINESS.maintainerReview,
            missingFields: [...ACCEPTED_SUBMISSION_IDENTIFIER_FIELDS],
        };
    }

    return {
        status: SUBMISSION_READINESS.review,
        missingFields: [
            ...ACCEPTED_SUBMISSION_IDENTIFIER_FIELDS,
            ...MAINTAINER_REVIEW_IDENTIFIER_FIELDS,
        ],
    };
}

function hasIdentifierCoverage(ids, fields) {
    return fields.some((field) => {
        const listField = `${field}s`;
        const list = Array.isArray(ids[listField]) ? ids[listField] : [];
        if (list.length > 0) {
            return true;
        }
        return Boolean(asText(ids[field]));
    });
}

function renderMarkdownSection(lines, heading, emptyMessage, items) {
    lines.push(heading, "");
    if (items.length === 0) {
        lines.push(emptyMessage, "", "");
        return;
    }

    for (const item of items) {
        renderMarkdownItem(lines, item);
    }
    lines.push("");
}

function renderMarkdownItem(lines, item) {
    const identity = asRecord(item.identity);
    const ids = asRecord(item.ids);
    const title = item.hullName || item.observedKey || "Observed hostile";
    const seen = formatSeenRange(item.firstSeen, item.lastSeen);
    lines.push(`### ${markdownText(title)}`, "");
    lines.push(`* Submission readiness: ${markdownText(valueOrUnknown(identity.submissionReadiness))}`);
    lines.push(`* Identity: ${markdownText(formatIdentitySummary(identity))}`);
    lines.push(`* Level: ${markdownText(valueOrUnknown(item.level))}`);
    lines.push(`* Faction: ${markdownText(valueOrUnknown(item.faction))}`);
    lines.push(`* Hull: ${markdownText(formatHullSummary(item))}`);
    lines.push(`* Seen: ${markdownText(seen)} (${markdownText(formatPassiveSightingCount(item.sightingCount))}; ${markdownText(formatObservationCount(item.observationCount))})`);
    lines.push(`* Source: ${markdownText(formatList(item.sourceSurfaces))}`);
    lines.push(`* Accepted IDs: ${markdownText(formatAcceptedIds(ids))}`);
    lines.push(`* Maintainer-review identifiers: ${markdownText(formatMaintainerReviewIds(ids))}`);
    if (Array.isArray(item.systems) && item.systems.length > 0) {
        lines.push("* Systems:");
        for (const system of item.systems) {
            lines.push(`  * ${markdownText(formatSystemEvidenceLine(system))}`);
        }
    }
    if (Array.isArray(identity.missingFields) && identity.missingFields.length > 0) {
        lines.push(`* Missing accepted/review IDs: ${markdownText(identity.missingFields.join(", "))}`);
    }
    lines.push(`* Baseline status: ${markdownText(valueOrUnknown(item.baselineStatus))}`);
    if (Array.isArray(item.notes) && item.notes.length > 0) {
        lines.push(`* Notes: ${markdownText(item.notes.join("; "))}`);
    }
    lines.push("");
}

function createCommunityReportSummary() {
    return {
        highConfidenceUntrackedCount: 0,
        submissionReadyCount: 0,
        readyForMaintainerReviewCount: 0,
        needsIdentifierReviewCount: 0,
        excludedMatchedCount: 0,
        excludedAmbiguousCount: 0,
        excludedCandidateCount: 0,
        excludedInsufficientSignalCount: 0,
        excludedUnmappedLowEvidenceCount: 0,
    };
}

function communityReportReference(referenceCatalog = {}) {
    const source = asText(referenceCatalog.packId) || "stfc-space.hostiles";
    const version = asText(referenceCatalog.version) || null;
    return {
        source,
        version,
        label: referenceCatalog.available === true
            ? [source, version].filter(Boolean).join(" ")
            : "Bundled hostile reference unavailable",
        available: referenceCatalog.available === true,
        entryCount: finiteIntegerOrNull(referenceCatalog.entryCount) ?? 0,
    };
}

function reportGeneratedAt(options) {
    if (typeof options.generatedAt === "string" && options.generatedAt.trim()) {
        return options.generatedAt.trim();
    }
    if (typeof options.now === "function") {
        const value = options.now();
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString();
        }
    }
    return new Date().toISOString();
}

function normalizedMatchHealthStatus(entry) {
    const status = asText(entry?.matchHealthStatus).toLowerCase().replaceAll("-", "_");
    if (["matched", "candidate", "ambiguous", "unmapped", "insufficient_signal"].includes(status)) {
        return status;
    }
    return normalizedBaselineStatus(entry?.baseline) || "insufficient_signal";
}

function normalizedBaselineStatus(baseline) {
    const status = asText(baseline?.status).toLowerCase().replaceAll("-", "_");
    return ["matched", "candidate", "ambiguous", "unmapped", "insufficient_signal"].includes(status)
        ? status
        : "";
}

function passiveSourceSurfaces(entry) {
    const passive = asRecord(asRecord(entry?.sourceCoverage).passive);
    return uniqueTextList([
        ...(Array.isArray(passive.surfaces) ? passive.surfaces : []),
        ...(Array.isArray(entry?.sourceSurfaces) ? entry.sourceSurfaces : []),
    ]).filter((surface) => surface === PASSIVE_SOURCE_SURFACE);
}

function hasStableObservedIdentity(entry, hullName) {
    if (hullName) {
        return true;
    }
    return STABLE_IDENTITY_KINDS.has(asText(entry?.identityKind));
}

function hasMeaningfulHullSignal(entry, hullSignals) {
    return Boolean(
        hullSignals.hullType
            || hullSignals.faction
            || hullSignals.grade
            || hullSignals.hullName
            || uniqueIntegerList([
                ...(Array.isArray(entry?.hullTypeValues) ? entry.hullTypeValues : []),
                asRecord(entry?.latestObservation).hullTypeValue,
            ]).length > 0
            || uniqueIntegerList([
                ...(Array.isArray(entry?.hullFactionValues) ? entry.hullFactionValues : []),
                asRecord(entry?.latestObservation).hullFactionValue,
            ]).length > 0
            || uniqueIntegerList([
                ...(Array.isArray(entry?.hullGrades) ? entry.hullGrades : []),
                asRecord(entry?.latestObservation).hullGrade,
            ]).length > 0,
    );
}

function hullSignalsForEntry(entry) {
    const latest = asRecord(entry?.latestObservation);
    const hullName = primaryText([latest.hullName, ...(Array.isArray(entry?.hullNames) ? entry.hullNames : [])]);
    const parsed = parseHullLabel(hullName);
    return {
        hullName: hullName || null,
        hullType: primaryText([
            latest.hullTypeName,
            ...(Array.isArray(entry?.hullTypeNames) ? entry.hullTypeNames : []),
            parsed.hullType,
        ]) || null,
        faction: parsed.faction,
        grade: parsed.grade ?? gradeFromValue(primaryInteger([
            latest.hullGrade,
            ...(Array.isArray(entry?.hullGrades) ? entry.hullGrades : []),
        ])),
        parsedLevel: parsed.level,
    };
}

function levelForEntry(entry, hullSignals) {
    const latest = asRecord(entry?.latestObservation);
    return primaryInteger([
        latest.userLevel,
        ...(Array.isArray(entry?.userLevels) ? entry.userLevels : []),
        hullSignals?.parsedLevel,
    ]);
}

function parseHullLabel(hullName) {
    const parts = asText(hullName).split("_").filter(Boolean);
    let level = null;
    let hullType = null;
    let faction = null;
    let grade = null;

    for (const part of parts) {
        const normalized = part.trim().toLowerCase();
        const levelMatch = /^l(\d+)$/u.exec(normalized);
        if (levelMatch) {
            level = finiteIntegerOrNull(levelMatch[1]);
            continue;
        }
        if (!hullType && HULL_TYPE_TOKENS.has(normalized)) {
            hullType = HULL_TYPE_TOKENS.get(normalized);
            continue;
        }
        if (!faction && FACTION_TOKENS.has(normalized)) {
            faction = FACTION_TOKENS.get(normalized);
            continue;
        }
        const gradeMatch = /^g(\d+)$/u.exec(normalized);
        if (gradeMatch) {
            grade = `G${gradeMatch[1]}`;
        }
    }

    return { level, hullType, faction, grade };
}

function gradeFromValue(value) {
    const grade = finiteIntegerOrNull(value);
    return grade != null && grade > 0 ? `G${grade}` : null;
}

function isCatalogObservedHostileEvent(entry) {
    if (!entry?.parsed || entry?.event?.type !== OBSERVED_HOSTILE_EVENT_TYPE) {
        return false;
    }

    const observation = asRecord(entry.event.observation);
    return observedHostileSourceSurfaceInfo(observation.sourceSurface).includeInCatalog === true;
}

function submissionReadinessForItem(item) {
    return asText(item?.identity?.submissionReadiness) || SUBMISSION_READINESS.review;
}

function countObservationWindows(timestamps = []) {
    const sorted = [...timestamps]
        .map((value) => finiteIntegerOrNull(value))
        .filter((value) => value != null)
        .sort((left, right) => left - right);
    if (sorted.length === 0) {
        return 0;
    }

    let windows = 0;
    let lastTimestampMs = null;
    for (const timestampMs of sorted) {
        if (lastTimestampMs == null || timestampMs - lastTimestampMs > REPORT_OBSERVATION_WINDOW_MS) {
            windows += 1;
        }
        lastTimestampMs = timestampMs;
    }
    return windows;
}

function compareCommunityReportItems(left, right) {
    const readinessCompare = compareSubmissionReadiness(submissionReadinessForItem(left), submissionReadinessForItem(right));
    if (readinessCompare !== 0) {
        return readinessCompare;
    }
    const systemCompare = comparePossiblyNumericText(primarySystemId(left), primarySystemId(right));
    if (systemCompare !== 0) {
        return systemCompare;
    }
    const levelCompare = (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER);
    if (levelCompare !== 0) {
        return levelCompare;
    }
    return String(left.hullName ?? left.observedKey ?? "").localeCompare(String(right.hullName ?? right.observedKey ?? ""));
}

function compareSubmissionReadiness(left, right) {
    const rank = (value) => {
        switch (value) {
            case SUBMISSION_READINESS.ready:
                return 0;
            case SUBMISSION_READINESS.maintainerReview:
                return 1;
            default:
                return 2;
        }
    };
    return rank(left) - rank(right);
}

function compareSystemEvidence(left, right) {
    const systemCompare = comparePossiblyNumericText(left?.systemId, right?.systemId);
    if (systemCompare !== 0) {
        return systemCompare;
    }
    return String(left?.firstSeen ?? "").localeCompare(String(right?.firstSeen ?? ""));
}

function primarySystemId(item) {
    if (asText(item?.systemId)) {
        return asText(item.systemId);
    }
    const systems = Array.isArray(item?.systems) ? item.systems : [];
    return asText(systems[0]?.systemId);
}

function comparePossiblyNumericText(left, right) {
    const leftText = asText(left);
    const rightText = asText(right);
    const leftNumber = Number.parseInt(leftText, 10);
    const rightNumber = Number.parseInt(rightText, 10);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }
    return leftText.localeCompare(rightText);
}

function formatHullSummary(item) {
    return [
        item.hullType,
        item.hullName,
        item.grade,
    ].filter(Boolean).join(" / ") || "Unknown";
}

function formatIdentitySummary(identity) {
    return [
        identity.kind,
        identity.key,
        identity.quality,
    ].filter(Boolean).join(" / ") || "Unknown";
}

function formatAcceptedIds(ids) {
    const parts = [];
    if (asText(ids.hullId)) {
        parts.push(`hullId=${ids.hullId}`);
    }
    return parts.length > 0 ? parts.join(", ") : "Unavailable";
}

function formatMaintainerReviewIds(ids) {
    const parts = [];
    if (asText(ids.userLocaId)) {
        parts.push(`userLocaId=${ids.userLocaId} (review aid only; not unique)`);
    }
    return parts.length > 0 ? parts.join(", ") : "Unavailable";
}

function formatSystemEvidenceLine(system) {
    const systemLabel = asText(system.systemId) ? `System ${system.systemId}` : "Unknown system";
    const seen = formatSeenRange(system.firstSeen, system.lastSeen);
    return `${systemLabel}: ${formatPassiveSightingCount(system.sightingCount)} across ${formatObservationCount(system.observationCount)}; seen ${seen}; source ${formatList(system.sourceSurfaces)}`;
}

function formatList(items) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    return list.length > 0 ? list.join(", ") : "Unknown";
}

function formatSeenRange(firstSeen, lastSeen) {
    if (firstSeen && lastSeen && firstSeen !== lastSeen) {
        return `${firstSeen} to ${lastSeen}`;
    }
    return lastSeen || firstSeen || "Unknown";
}

function formatPassiveSightingCount(value) {
    const count = finiteIntegerOrNull(value);
    if (count == null) {
        return "Unknown passive sightings";
    }
    return `${count} passive ${count === 1 ? "sighting" : "sightings"}`;
}

function formatObservationCount(value) {
    const count = finiteIntegerOrNull(value);
    if (count == null) {
        return "unknown observation windows";
    }
    return `${count} observation ${count === 1 ? "window" : "windows"}`;
}

function valueOrUnknown(value) {
    return value == null || value === "" ? "Unknown" : String(value);
}

function markdownText(value) {
    return String(value ?? "")
        .replaceAll("\r", " ")
        .replaceAll("\n", " ")
        .trim();
}

function primaryText(values) {
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = asText(value);
        if (normalized) {
            return normalized;
        }
    }
    return "";
}

function primaryInteger(values) {
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = finiteIntegerOrNull(value);
        if (normalized != null) {
            return normalized;
        }
    }
    return null;
}

function uniqueTextList(values) {
    const items = [];
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = asText(value);
        if (normalized && !items.includes(normalized)) {
            items.push(normalized);
        }
    }
    return items;
}

function uniqueIntegerList(values) {
    const items = [];
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = finiteIntegerOrNull(value);
        if (normalized != null && !items.includes(normalized)) {
            items.push(normalized);
        }
    }
    return items;
}

function addUnique(items, value) {
    const normalized = asText(value);
    if (normalized && !items.includes(normalized)) {
        items.push(normalized);
    }
}

function finiteIntegerOrNull(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseInstantMs(value) {
    const instant = Date.parse(String(value ?? ""));
    return Number.isFinite(instant) ? instant : null;
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
    if (currentMs == null || candidateMs == null) {
        return candidate;
    }
    return candidateMs > currentMs ? candidate : current;
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
