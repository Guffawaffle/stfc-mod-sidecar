const DEFAULT_ACTIVITY_LIMIT = 6;
const MAX_ACTIVITY_LIMIT = 25;

export function resolveFleetActivityLimit(value, fallback = DEFAULT_ACTIVITY_LIMIT) {
    const parsed = Number.parseInt(value ?? `${fallback}`, 10);
    const safeValue = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(Math.max(safeValue, 1), MAX_ACTIVITY_LIMIT);
}

export function buildFleetActivitySnapshot(snapshot = {}, options = {}) {
    const limit = resolveFleetActivityLimit(options.limit);
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const items = events
        .filter((entry) => entry?.parsed !== false)
        .slice(0, limit)
        .map(activityItemFromSummary)
        .filter(Boolean);

    return {
        ok: snapshot.ok !== false,
        source: "fleet.activity.preview",
        provisional: true,
        stability: "preview",
        generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        dataSource: {
            source: snapshot.source ?? "store",
            storageBackend: snapshot.storageBackend ?? null,
            detail: snapshot.detail ?? "summary",
        },
        totalEvents: Number.isFinite(snapshot.totalLines) ? snapshot.totalLines : events.length,
        returnedEvents: items.length,
        eventsWindow: Number.isFinite(snapshot.returnedLines) ? snapshot.returnedLines : events.length,
        items,
        error: snapshot.ok === false ? snapshot.error ?? "Activity summary unavailable" : undefined,
    };
}

function activityItemFromSummary(entry) {
    const summary = isRecord(entry.summary) ? entry.summary : {};
    const eventType = text(entry.eventType) || text(entry.event?.type) || "activity.event";
    const lineNumber = Number.isFinite(entry.lineNumber) ? entry.lineNumber : null;
    const battleId = text(entry.battleId);
    const journalId = text(entry.journalId);
    const id = battleId || journalId || (lineNumber !== null ? `line-${lineNumber}` : `${eventType}-${text(summary.timestamp) || "unknown"}`);
    const chips = normalizeChips(summary.chips, eventType);

    return {
        id,
        lineNumber,
        eventType,
        battleId: battleId || null,
        journalId: journalId || null,
        timestamp: text(summary.timestamp) || text(entry.timestamp),
        title: text(summary.title) || formatEventType(eventType),
        subtitle: text(summary.subtitle),
        chips,
        status: chips[0] ?? formatEventType(eventType),
        diagnosticsHref: "/diagnostics/",
    };
}

function normalizeChips(value, fallback) {
    const chips = Array.isArray(value) ? value.map(text).filter(Boolean) : [];
    if (chips.length === 0) {
        chips.push(fallback);
    }

    return [...new Set(chips)].slice(0, 4);
}

function formatEventType(value) {
    return String(value ?? "activity")
        .replace(/[._-]+/gu, " ")
        .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value) {
    return typeof value === "string" ? value.trim() : "";
}