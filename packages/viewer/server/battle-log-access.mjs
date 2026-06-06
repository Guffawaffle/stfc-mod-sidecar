import { buildBattleExplanation } from "./battle-explanation.mjs";
import { buildResolvedRuntimeEffectOverlay } from "./runtime-effect-enrichment.mjs";

const BATTLE_EVENT_TYPES = new Set(["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"]);

export function buildBattleIndexSnapshot(snapshot = {}, options = {}) {
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const groups = buildBattleGroupsFromEntries(events);
    const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : groups.length;
    const battles = groups.slice(0, limit).map(toBattleIndexEntry);
    const sourceDiagnostics = describeBattleSnapshotSource(snapshot);

    return {
        ok: snapshot.ok !== false,
        source: sourceDiagnostics.source,
        storageBackend: snapshot.storageBackend ?? null,
        effectiveSource: sourceDiagnostics.key,
        sourceDiagnostics,
        exists: snapshot.exists !== false,
        detail: "battle-index",
        generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        pollHintMs: snapshot.pollHintMs,
        totalEvents: snapshot.totalLines ?? events.length,
        scannedEvents: events.length,
        totalBattles: groups.length,
        returnedBattles: battles.length,
        battles,
        error: snapshot.ok === false ? snapshot.error ?? "Battle index unavailable" : undefined,
    };
}

export function buildBattleDetailSnapshot(snapshot = {}, battleKey = "") {
    const normalizedKey = normalizeBattleKey(battleKey);
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const group = buildBattleGroupsFromEntries(events).find((item) => item.key === normalizedKey);
    const sourceDiagnostics = describeBattleSnapshotSource(snapshot);

    if (!group) {
        return {
            ok: false,
            source: sourceDiagnostics.source,
            storageBackend: snapshot.storageBackend ?? null,
            effectiveSource: sourceDiagnostics.key,
            sourceDiagnostics,
            exists: snapshot.exists !== false,
            detail: "battle-detail",
            statusCode: 404,
            battleId: normalizedKey,
            events: [],
            error: "Battle detail not available in the local event store",
        };
    }

    const enrichment = enrichBattleDetailEntries(group);

    return {
        ok: true,
        source: sourceDiagnostics.source,
        storageBackend: snapshot.storageBackend ?? null,
        effectiveSource: sourceDiagnostics.key,
        sourceDiagnostics,
        exists: snapshot.exists !== false,
        detail: "battle-detail",
        generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        battle: toBattleIndexEntry(group),
        battleId: group.key,
        events: enrichment.entries,
        derivedViews: {
            runtimeEffectOverlay: enrichment.overlay,
            battleExplanation: enrichment.explanation,
            battleTimeline: enrichment.explanation?.battleTimeline ?? null,
        },
    };
}

export function battleIndexUpdatesFromEvents(events = []) {
    const groups = buildBattleGroupsFromEntries(events.map((event, index) => ({
        parsed: true,
        lineNumber: Number(event?.lineNumber ?? index + 1),
        event,
        eventType: event?.type,
        battleId: event?.battleId,
        journalId: event?.journalId,
        battleType: event?.battleType,
        timestamp: event?.timestamp,
        capturedAtUnixMs: eventCapturedAtUnixMs(event),
        summary: summarizeEventLike(event),
    })));

    return groups.map(toBattleIndexEntry);
}

export function buildBattleGroupsFromEntries(entries = []) {
    const groups = new Map();

    for (const entry of entries) {
        if (!entry?.parsed) {
            continue;
        }

        const eventType = entryEventType(entry);
        if (!BATTLE_EVENT_TYPES.has(eventType)) {
            continue;
        }

        const key = entryBattleKey(entry);
        if (!key) {
            continue;
        }

        const group = groups.get(key) ?? {
            key,
            entries: [],
            lineNumber: 0,
            timestamp: "",
            capturedAtUnixMs: null,
            battleType: null,
            title: "",
            subtitle: "",
            hasCapture: false,
            hasReport: false,
            hasCatalog: false,
            hasAnalytics: false,
            participantNames: [],
            eventTypes: new Set(),
            lineNumbers: {},
        };

        group.entries.push(entry);
        group.eventTypes.add(eventType);
        group.lineNumber = Math.max(group.lineNumber, Number(entry.lineNumber ?? 0));
        group.timestamp = newestTimestamp(group.timestamp, entry.timestamp ?? entry.summary?.timestamp);
        group.capturedAtUnixMs = newestCapturedAtUnixMs(group.capturedAtUnixMs, entryCapturedAtUnixMs(entry));
        group.battleType = group.battleType ?? entry.battleType ?? entry.event?.battleType ?? null;
        group.title = bestTitle(group.title, entry.summary?.title, eventType);
        group.subtitle = group.subtitle || String(entry.summary?.subtitle ?? "");
        group.participantNames = mergeParticipantNames(group.participantNames, entry);

        if (eventType === "battle.capture") {
            group.hasCapture = true;
            group.lineNumbers.capture = entry.lineNumber;
        } else if (eventType === "battle.report") {
            group.hasReport = true;
            group.lineNumbers.report = entry.lineNumber;
        } else if (eventType === "catalog.snapshot") {
            group.hasCatalog = true;
            group.lineNumbers.catalog = entry.lineNumber;
        } else if (eventType === "battle.analytics") {
            group.hasAnalytics = true;
            group.lineNumbers.analytics = entry.lineNumber;
        }

        groups.set(key, group);
    }

    return [...groups.values()].sort((left, right) => right.lineNumber - left.lineNumber);
}

function toBattleIndexEntry(group) {
    return {
        battleId: group.key,
        key: group.key,
        timestamp: group.timestamp,
        capturedAtUnixMs: group.capturedAtUnixMs,
        battleType: group.battleType,
        title: group.title || `Battle ${group.key}`,
        subtitle: group.subtitle,
        participantNames: group.participantNames,
        playerSummary: group.subtitle,
        opponentSummary: group.title,
        eventCount: group.entries.length,
        lineNumber: group.lineNumber,
        lineNumbers: group.lineNumbers,
        completeness: {
            hasCapture: group.hasCapture,
            hasReport: group.hasReport,
            hasCatalog: group.hasCatalog,
            hasAnalytics: group.hasAnalytics,
        },
    };
}

function enrichBattleDetailEntries(group) {
    const captureEntry = latestEntryOfType(group.entries, "battle.capture");
    const reportEntry = latestEntryOfType(group.entries, "battle.report");
    const analyticsEntry = latestEntryOfType(group.entries, "battle.analytics");
    const catalogEntry = latestEntryOfType(group.entries, "catalog.snapshot");
    if (!analyticsEntry?.event || !catalogEntry?.event || !sameBattleEnvelope(analyticsEntry.event, catalogEntry.event)) {
        const overlay = buildResolvedRuntimeEffectOverlay(null, null);
        return {
            entries: group.entries,
            overlay,
            explanation: buildBattleExplanation({
                battleId: group.key,
                captureEvent: captureEntry?.event,
                reportEvent: reportEntry?.event,
                analyticsEvent: analyticsEntry?.event,
                catalogSnapshotEvent: catalogEntry?.event,
                runtimeEffectOverlay: overlay,
            }),
        };
    }

    const overlay = buildResolvedRuntimeEffectOverlay(analyticsEntry.event, catalogEntry.event);
    return {
        entries: group.entries,
        overlay,
        explanation: buildBattleExplanation({
            battleId: group.key,
            captureEvent: captureEntry?.event,
            reportEvent: reportEntry?.event,
            analyticsEvent: analyticsEntry.event,
            catalogSnapshotEvent: catalogEntry.event,
            runtimeEffectOverlay: overlay,
        }),
    };
}

function latestEntryOfType(entries, type) {
    return entries
        .filter((entry) => entryEventType(entry) === type)
        .sort((left, right) => Number(right.lineNumber ?? 0) - Number(left.lineNumber ?? 0))[0] ?? null;
}

function sameBattleEnvelope(left, right) {
    const leftBattleId = normalizedEnvelopeId(left?.battleId);
    const rightBattleId = normalizedEnvelopeId(right?.battleId);
    if (leftBattleId && rightBattleId && leftBattleId === rightBattleId) {
        return true;
    }

    const leftJournalId = normalizedEnvelopeId(left?.journalId);
    const rightJournalId = normalizedEnvelopeId(right?.journalId);
    return Boolean(leftJournalId && rightJournalId && leftJournalId === rightJournalId);
}

function normalizedEnvelopeId(value) {
    return typeof value === "string" ? value.trim() : "";
}

function entryEventType(entry) {
    return String(entry.event?.type ?? entry.eventType ?? "");
}

function entryBattleKey(entry) {
    return normalizeBattleKey(entry.event?.battleId ?? entry.battleId ?? entry.event?.journalId ?? entry.journalId);
}

function normalizeBattleKey(value) {
    return String(value ?? "").trim();
}

function newestTimestamp(left, right) {
    const normalizedRight = String(right ?? "");
    if (!normalizedRight) {
        return left || "";
    }
    if (!left) {
        return normalizedRight;
    }
    const rightMs = parseInstantMs(normalizedRight);
    const leftMs = parseInstantMs(left);
    if (rightMs == null) {
        return left;
    }
    if (leftMs == null) {
        return normalizedRight;
    }
    return rightMs >= leftMs ? normalizedRight : left;
}

function newestCapturedAtUnixMs(left, right) {
    if (right == null) {
        return left ?? null;
    }
    if (left == null) {
        return right;
    }
    return right >= left ? right : left;
}

function bestTitle(current, candidate, eventType) {
    const normalized = String(candidate ?? "");
    if (!normalized) {
        return current;
    }
    if (!current || eventType === "battle.report") {
        return normalized;
    }
    return current;
}

function mergeParticipantNames(current, entry) {
    const names = new Set(current);
    const subtitle = String(entry.summary?.subtitle ?? "");
    for (const part of subtitle.split(",")) {
        const name = part.trim();
        if (name) {
            names.add(name);
        }
    }
    const participants = entry.event?.capture?.participants;
    if (Array.isArray(participants)) {
        for (const participant of participants) {
            const name = String(participant?.name ?? participant?.displayName ?? "").trim();
            if (name) {
                names.add(name);
            }
        }
    }
    return [...names].slice(0, 8);
}

function summarizeEventLike(event) {
    if (!event || typeof event !== "object") {
        return {};
    }
    const summary = event.report?.summary ?? event.capture?.summary ?? event.analytics?.summary ?? {};
    return {
        title: summary.targetId ?? event.battleId ?? event.journalId ?? event.type,
        subtitle: summary.outcome ?? "",
        timestamp: event.timestamp,
    };
}

function describeBattleSnapshotSource(snapshot = {}) {
    const source = resolvedSnapshotSource(snapshot);
    const key = effectiveBattleSourceKey(snapshot);
    const feedPath = typeof snapshot.feedPath === "string" && snapshot.feedPath.trim() ? snapshot.feedPath : null;
    return {
        key,
        source,
        label: battleSourceLabel(key),
        storageBackend: snapshot.storageBackend ?? null,
        feedPath,
        fallbackActive: key === "jsonl_fallback",
    };
}

function effectiveBattleSourceKey(snapshot = {}) {
    const source = resolvedSnapshotSource(snapshot);
    if (source === "store") {
        if (snapshot.storageBackend === "sqlite") {
            return "sqlite";
        }
        if (snapshot.storageBackend === "postgres") {
            return "postgres";
        }
        return "unknown";
    }
    if (source === "jsonl_fallback") {
        return "jsonl_fallback";
    }
    if (source === "majel-ingest-memory") {
        return "memory_feed";
    }
    return "unknown";
}

function resolvedSnapshotSource(snapshot = {}) {
    if (typeof snapshot.source === "string" && snapshot.source.trim().length > 0) {
        return snapshot.source.trim();
    }
    if (typeof snapshot.feedPath === "string" && snapshot.feedPath.trim().length > 0) {
        return "jsonl_fallback";
    }
    return "unknown";
}

function battleSourceLabel(key) {
    switch (key) {
        case "sqlite":
            return "SQLite event store";
        case "postgres":
            return "PostgreSQL event store";
        case "jsonl_fallback":
            return "JSONL fallback";
        case "memory_feed":
            return "In-memory feed";
        default:
            return "Unknown source";
    }
}

function entryCapturedAtUnixMs(entry) {
    return firstFiniteNumber(
        entry?.capturedAtUnixMs,
        entry?.event?.capturedAtUnixMs,
        entry?.event?.capture?.capturedAtUnixMs,
    );
}

function eventCapturedAtUnixMs(event) {
    return firstFiniteNumber(
        event?.capturedAtUnixMs,
        event?.capture?.capturedAtUnixMs,
    );
}

function firstFiniteNumber(...values) {
    for (const value of values) {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }

    return null;
}

function parseInstantMs(value) {
    const normalized = normalizeUtcInstantString(value);
    if (!normalized) {
        return null;
    }

    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
}

function normalizeUtcInstantString(value) {
    const text = String(value ?? "").trim();
    if (!text) {
        return "";
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text) && !/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(text)) {
        return `${text}Z`;
    }

    return text;
}
