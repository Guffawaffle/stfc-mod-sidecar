export function classifyObservedHostilePayload(payload) {
    if (!payload || payload.ok !== true || payload.exists === false) {
        return "unavailable";
    }

    const entries = Array.isArray(payload.entries) ? payload.entries : [];
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

function searchableEntryText(entry) {
    const latest = asRecord(entry?.latestObservation);
    return [
        entry?.title,
        entry?.key,
        entry?.identityKind,
        entry?.identityQuality,
        entry?.strongestConfidence,
        ...(Array.isArray(entry?.sourceSurfaces) ? entry.sourceSurfaces : []),
        ...(Array.isArray(entry?.hullIds) ? entry.hullIds : []),
        ...(Array.isArray(entry?.hullNames) ? entry.hullNames : []),
        ...(Array.isArray(entry?.runtimeFleetIds) ? entry.runtimeFleetIds : []),
        ...(Array.isArray(entry?.locationTranslationIds) ? entry.locationTranslationIds : []),
        ...(Array.isArray(entry?.userIds) ? entry.userIds : []),
        latest?.sourceSurface,
        latest?.runtimeFleetId,
        latest?.hullId,
        latest?.hullName,
        latest?.locationTranslationId,
        latest?.userId,
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
