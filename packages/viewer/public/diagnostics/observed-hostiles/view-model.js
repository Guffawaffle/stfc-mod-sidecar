export function classifyObservedHostilePayload(payload) {
    if (!payload || payload.ok !== true || payload.exists === false) {
        return "unavailable";
    }

    const entries = Array.isArray(payload.entries)
        ? payload.entries
        : Array.isArray(payload.items)
            ? payload.items
            : [];
    if (entries.length === 0) {
        return "empty";
    }

    return "entries";
}

export function filterObservedHostileEntries(entries, searchText) {
    const normalizedNeedle = normalizeSearchText(searchText);
    const list = Array.isArray(entries) ? entries : [];
    if (!normalizedNeedle) {
        return list;
    }

    return list.filter((entry) => normalizeSearchText(searchableEntryText(entry)).includes(normalizedNeedle));
}

export function describeObservedHostileSource(snapshot) {
    const source = String(snapshot?.source ?? "").trim().toLowerCase();
    const backend = String(snapshot?.storageBackend ?? "").trim().toLowerCase();

    if (source === "store" && backend === "sqlite") {
        return {
            label: "Store (SQLite)",
            title: "Observed hostile catalog is reading from the SQLite sidecar event store.",
        };
    }

    if (source === "store" && backend === "postgres") {
        return {
            label: "Store (PostgreSQL)",
            title: "Observed hostile catalog is reading from the PostgreSQL sidecar event store.",
        };
    }

    if (source === "store") {
        return {
            label: "Store",
            title: "Observed hostile catalog is reading from the sidecar event store.",
        };
    }

    if (source) {
        return {
            label: titleCase(source.replaceAll("_", " ")),
            title: `Observed hostile catalog reported source '${source}'.`,
        };
    }

    return {
        label: "Unknown",
        title: "Observed hostile catalog could not determine its backing source.",
    };
}

export function describeObservedHostileIdentityQuality(value) {
    switch (String(value ?? "").trim()) {
        case "candidate_game_identity":
            return "Candidate game identity from game-facing data. Useful for cross-session comparison, but not yet proven durable.";
        case "coarse_shared":
            return "Shared hull/template grouping. Useful for catalog coverage, not for distinguishing individual hostiles.";
        case "coarse_label":
            return "Label-based grouping only. Multiple hostile variants can collapse into the same bucket.";
        case "transient_runtime":
            return "Runtime scene identity. Useful while loaded, not durable across reloads.";
        case "process_local":
            return "Process-local pointer evidence only. Diagnostic value is limited to the current process lifetime.";
        default:
            return "Identity quality is opaque or not yet classified.";
    }
}

export function describeObservedHostileEvidenceTier(value) {
    switch (String(value ?? "").trim()) {
        case "tier1_passive_system_view":
            return {
                label: "Passive system view",
                title: "Counted from the canonical FleetDataSystem passive system-view source.",
            };
        case "tier2_view_adjacent_ui":
            return {
                label: "Supplemental UI",
                title: "Captured from a view-adjacent target widget. Useful for drilldown, but not counted as passive hostile coverage.",
            };
        case "tier3_interactive":
            return {
                label: "Interactive",
                title: "Requires user interaction or scan-adjacent context and stays out of passive hostile counts.",
            };
        default:
            return {
                label: "Unclassified",
                title: "Source evidence is not yet classified for passive hostile counting.",
            };
    }
}

export function describeObservedHostileBaseline(baseline) {
    const status = String(baseline?.status ?? "").trim().toLowerCase();
    switch (status) {
        case "matched":
            return {
                label: "Baseline matched",
                title: String(baseline?.summary ?? "Bundled hostile baseline found one high-confidence candidate."),
            };
        case "candidate":
            return {
                label: "Baseline candidate",
                title: String(baseline?.summary ?? "Bundled hostile baseline found one likely candidate."),
            };
        case "ambiguous":
            return {
                label: "Baseline ambiguous",
                title: String(baseline?.summary ?? "Bundled hostile baseline found multiple plausible candidates."),
            };
        case "unmapped":
            return {
                label: "Baseline unmapped",
                title: String(baseline?.summary ?? "No bundled hostile baseline candidates matched."),
            };
        case "insufficient_signal":
            return {
                label: "Baseline waiting",
                title: String(baseline?.summary ?? "Stored observations do not yet include enough stable fields for baseline comparison."),
            };
        default:
            return {
                label: "Baseline unavailable",
                title: String(baseline?.summary ?? "Bundled hostile baseline data is unavailable."),
            };
    }
}

export function describeObservedHostileReferencePresence(value) {
    switch (String(value ?? "").trim().toLowerCase()) {
        case "known":
            return {
                label: "Known by STFC.space",
                title: "Observed fields align with one or more bundled STFC.space hostile entries.",
            };
        case "unknown":
            return {
                label: "Gap Candidate",
                title: "No bundled STFC.space hostile entries matched the current observed fields. Review before treating this as a confirmed reference gap.",
            };
        case "needs_signal":
            return {
                label: "Needs Signal",
                title: "There is not enough stable observed data to decide whether this hostile is already known by bundled STFC.space data.",
            };
        default:
            return {
                label: "Reference Unavailable",
                title: "Bundled STFC.space hostile reference data is unavailable.",
            };
    }
}

export function formatObservedHostileList(items, options = {}) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : list.length;
    if (list.length === 0) {
        return options.fallback ?? "None";
    }

    const head = list.slice(0, limit);
    const remainder = list.length - head.length;
    return remainder > 0
        ? `${head.join(", ")} +${remainder}`
        : head.join(", ");
}

export function describeObservedHostileCommunityReportCta(report) {
    if (!report) {
        return {
            visible: false,
            disabled: true,
            label: "Help the Community",
            description: "Checking for high-confidence missing hostiles.",
            actionLabel: "Export Community Report",
            badgeText: "Checking...",
            count: 0,
            submissionReadyCount: 0,
            readyForMaintainerReviewCount: 0,
            reviewOnlyCount: 0,
            state: "quiet",
        };
    }

    if (report.ok === false) {
        return {
            visible: true,
            disabled: true,
            label: "Community report unavailable",
            description: String(report.error ?? "Observed hostile community report data is unavailable."),
            actionLabel: "Export Community Report",
            badgeText: "Report unavailable",
            count: 0,
            submissionReadyCount: 0,
            readyForMaintainerReviewCount: 0,
            reviewOnlyCount: 0,
            state: "quiet",
        };
    }

    const count = Number(report?.summary?.highConfidenceUntrackedCount ?? 0);
    const submissionReadyCount = Number(report?.summary?.submissionReadyCount ?? 0);
    const readyForMaintainerReviewCount = Number(report?.summary?.readyForMaintainerReviewCount ?? 0);
    const reviewOnlyCount = Number(report?.summary?.needsIdentifierReviewCount ?? 0);
    if (submissionReadyCount > 0) {
        const reviewTotal = readyForMaintainerReviewCount + reviewOnlyCount;
        return {
            visible: true,
            disabled: false,
            label: "Help the Community",
            description: reviewTotal > 0
                ? `We found ${submissionReadyCount} submission-ready unmapped observations, ${readyForMaintainerReviewCount} rows ready for maintainer review, and ${reviewOnlyCount} weaker rows that still need identifier review.`
                : (submissionReadyCount === 1
                    ? "We found 1 submission-ready passive observation that is not in the current reference pack."
                    : `We found ${submissionReadyCount} submission-ready passive observations that are not in the current reference pack.`),
            actionLabel: "Export Community Report",
            badgeText: reviewTotal > 0
                ? `${submissionReadyCount} submission-ready / ${readyForMaintainerReviewCount} maintainer-review / ${reviewOnlyCount} weaker`
                : `${submissionReadyCount} submission-ready`,
            count,
            submissionReadyCount,
            readyForMaintainerReviewCount,
            reviewOnlyCount,
            state: "ready",
        };
    }

    if (readyForMaintainerReviewCount > 0) {
        return {
            visible: true,
            disabled: false,
            label: "Review Unmapped Observations",
            description: reviewOnlyCount > 0
                ? `We found ${readyForMaintainerReviewCount} high-confidence unmapped observations with maintainer-review identifiers and ${reviewOnlyCount} weaker rows that still need stronger identity coverage.`
                : (readyForMaintainerReviewCount === 1
                    ? "We found 1 high-confidence unmapped observation with maintainer-review identifiers, but it is not yet submission-ready."
                    : `We found ${readyForMaintainerReviewCount} high-confidence unmapped observations with maintainer-review identifiers, but they are not yet submission-ready.`),
            actionLabel: "Export Evidence Report",
            badgeText: reviewOnlyCount > 0
                ? `${readyForMaintainerReviewCount} maintainer-review / ${reviewOnlyCount} weaker`
                : `${readyForMaintainerReviewCount} maintainer-review`,
            count,
            submissionReadyCount,
            readyForMaintainerReviewCount,
            reviewOnlyCount,
            state: "ready",
        };
    }

    if (reviewOnlyCount > 0) {
        return {
            visible: true,
            disabled: false,
            label: "Review Unmapped Observations",
            description: reviewOnlyCount === 1
                ? "We found 1 high-confidence unmapped observation, but it still needs stronger identifier coverage before maintainer review."
                : `We found ${reviewOnlyCount} high-confidence unmapped observations, but they still need stronger identifier coverage before maintainer review.`,
            actionLabel: "Export Evidence Report",
            badgeText: `${reviewOnlyCount} weaker`,
            count,
            submissionReadyCount,
            readyForMaintainerReviewCount,
            reviewOnlyCount,
            state: "quiet",
        };
    }

    return {
        visible: true,
        disabled: true,
        label: "No high-confidence missing hostiles found.",
        description: "Observed rows are either matched, candidate, ambiguous, waiting for signal, or below the conservative evidence gate.",
        actionLabel: "Export Community Report",
        badgeText: "No report rows",
        count: 0,
        submissionReadyCount,
        readyForMaintainerReviewCount,
        reviewOnlyCount,
        state: "quiet",
    };
}

function searchableEntryText(entry) {
    const latest = asRecord(entry?.latestObservation);
    return [
        entry?.title,
        entry?.key,
        entry?.identityKind,
        entry?.identityQuality,
        entry?.evidenceTier,
        entry?.referencePresence,
        entry?.strongestConfidence,
        ...(Array.isArray(entry?.sourceSurfaces) ? entry.sourceSurfaces : []),
        ...(Array.isArray(entry?.hullIds) ? entry.hullIds : []),
        ...(Array.isArray(entry?.hullNames) ? entry.hullNames : []),
        ...(Array.isArray(entry?.runtimeFleetIds) ? entry.runtimeFleetIds : []),
        ...(Array.isArray(entry?.locationTranslationIds) ? entry.locationTranslationIds : []),
        ...(Array.isArray(entry?.userIds) ? entry.userIds : []),
        ...(Array.isArray(entry?.systemIds) ? entry.systemIds : []),
        ...(Array.isArray(entry?.galaxyIds) ? entry.galaxyIds : []),
        ...(Array.isArray(entry?.instanceIds) ? entry.instanceIds : []),
        ...(Array.isArray(entry?.userLevels) ? entry.userLevels : []),
        ...(Array.isArray(entry?.userLocaIds) ? entry.userLocaIds : []),
        ...(Array.isArray(entry?.hullTypeNames) ? entry.hullTypeNames : []),
        ...(Array.isArray(entry?.fleetTypeNames) ? entry.fleetTypeNames : []),
        latest?.sourceSurface,
        latest?.sourceTier,
        latest?.runtimeFleetId,
        latest?.hullId,
        latest?.hullName,
        latest?.locationTranslationId,
        latest?.userId,
        latest?.systemId,
        latest?.galaxyId,
        latest?.instanceId,
        latest?.hullTypeName,
        latest?.fleetTypeName,
        entry?.baseline?.summary,
        ...(Array.isArray(entry?.baseline?.matches) ? entry.baseline.matches.flatMap((match) => [
            match?.hostileId,
            match?.name,
            match?.factionName,
        ]) : []),
    ].filter(Boolean).join(" ");
}

function normalizeSearchText(value) {
    return String(value ?? "").trim().toLowerCase();
}

function titleCase(value) {
    return String(value ?? "")
        .split(/\s+/u)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
