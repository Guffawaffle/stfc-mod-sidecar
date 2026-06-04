const BATTLE_EVENT_TYPES = new Set(["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"]);

export function buildBattleIndexSnapshot(snapshot = {}, options = {}) {
    const events = Array.isArray(snapshot.events) ? snapshot.events : [];
    const groups = buildBattleGroupsFromEntries(events);
    const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : groups.length;
    const battles = groups.slice(0, limit).map(toBattleIndexEntry);

    return {
        ok: snapshot.ok !== false,
        source: snapshot.source ?? "store",
        storageBackend: snapshot.storageBackend ?? null,
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

    if (!group) {
        return {
            ok: false,
            source: snapshot.source ?? "store",
            storageBackend: snapshot.storageBackend ?? null,
            exists: snapshot.exists !== false,
            detail: "battle-detail",
            statusCode: 404,
            battleId: normalizedKey,
            events: [],
            error: "Battle detail not available in the local event store",
        };
    }

    return {
        ok: true,
        source: snapshot.source ?? "store",
        storageBackend: snapshot.storageBackend ?? null,
        exists: snapshot.exists !== false,
        detail: "battle-detail",
        generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        battle: toBattleIndexEntry(group),
        battleId: group.key,
        events: group.entries,
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
    return Date.parse(normalizedRight) >= Date.parse(left) ? normalizedRight : left;
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
