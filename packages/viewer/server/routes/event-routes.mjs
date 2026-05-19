import { sendJson } from "../static-files.mjs";

const BATTLE_EVENT_TYPES = Object.freeze([
    "battle.event",
    "battle.capture",
    "battle.analytics",
    "battle.report",
    "catalog.snapshot",
]);
const BATTLE_EVENT_TYPE_SET = new Set(BATTLE_EVENT_TYPES);
const DEVELOPER_EVENT_TYPES = Object.freeze([
    "debug.event",
    "hook.event",
    "session.event",
    "integration.event",
]);
const KNOWN_EVENT_TYPES = new Set([...BATTLE_EVENT_TYPES, ...DEVELOPER_EVENT_TYPES]);

export async function handleEventRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/events") {
        if (request.method === "POST") {
            await context.handleEventIngest(request, response);
            return true;
        }

        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const limitValue = Number.parseInt(requestUrl.searchParams.get("limit") ?? `${context.defaultLimit}`, 10);
        const detailMode = requestUrl.searchParams.get("detail") ?? "full";
        const eventScope = resolveEventScope(requestUrl, context);
        if (!eventScope.ok) {
            sendJson(response, eventScope.statusCode, eventScope.payload);
            return true;
        }

        const snapshot = await context.readEventsSnapshot(Number.isFinite(limitValue) ? limitValue : context.defaultLimit, {
            includeDetails: detailMode !== "summary",
            eventTypes: eventScope.eventTypes,
        });
        sendJson(response, 200, snapshot);
        return true;
    }

    if (requestUrl.pathname === "/api/events/stream") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        context.handleEventStream(request, response);
        return true;
    }

    const eventLineMatch = /^\/api\/events\/([0-9]+)$/.exec(requestUrl.pathname);
    if (eventLineMatch) {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const lineNumber = Number.parseInt(eventLineMatch[1], 10);
        const eventScope = resolveEventScope(requestUrl, context);
        if (!eventScope.ok) {
            sendJson(response, eventScope.statusCode, eventScope.payload);
            return true;
        }

        const detail = await context.readEventDetail(lineNumber, { eventTypes: eventScope.eventTypes });
        sendJson(response, detail.ok ? 200 : detail.statusCode ?? 404, detail);
        return true;
    }

    return false;
}

function resolveEventScope(requestUrl, context) {
    const explicitTypes = parseEventTypes(requestUrl.searchParams.get("types"));
    if (explicitTypes === undefined) {
        return {
            ok: false,
            statusCode: 400,
            payload: { ok: false, error: "Unknown event type filter" },
        };
    }

    const scope = String(requestUrl.searchParams.get("scope") ?? "battle").trim().toLowerCase();
    const eventTypes = explicitTypes.length > 0 ? explicitTypes : eventTypesForScope(scope);
    if (eventTypes === undefined) {
        return {
            ok: false,
            statusCode: 400,
            payload: { ok: false, error: `Unknown event scope: ${scope}` },
        };
    }

    const hasDeveloperTypes = eventTypes === null || eventTypes.some((eventType) => !BATTLE_EVENT_TYPE_SET.has(eventType));
    if (hasDeveloperTypes && !context.developerMode) {
        return {
            ok: false,
            statusCode: 403,
            payload: context.developerModeRequiredPayload?.() ?? { ok: false, error: "Developer mode required" },
        };
    }

    return { ok: true, eventTypes };
}

function eventTypesForScope(scope) {
    if (scope === "battle") {
        return [...BATTLE_EVENT_TYPES];
    }

    if (scope === "debug") {
        return [...DEVELOPER_EVENT_TYPES];
    }

    if (scope === "all") {
        return null;
    }

    return undefined;
}

function parseEventTypes(value) {
    if (!value) {
        return [];
    }

    const eventTypes = value.split(",").map((part) => part.trim()).filter(Boolean);
    if (eventTypes.some((eventType) => !KNOWN_EVENT_TYPES.has(eventType))) {
        return undefined;
    }

    return [...new Set(eventTypes)];
}
