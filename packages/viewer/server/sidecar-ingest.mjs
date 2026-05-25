export const SIDECAR_INGEST_PROTOCOL_VERSION = "stfc.sidecar.ingest.v1";
export const SIDECAR_BATTLE_EVENTS_KIND = "battle.events";
export const SIDECAR_FLEET_RUNTIME_KIND = "fleet.runtime";
export const SIDECAR_EVENTS_PROTOCOL_VERSION = "stfc.sidecar.events.v0";
export const SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION = SIDECAR_EVENTS_PROTOCOL_VERSION;
export const SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION = "stfc.fleet.runtime_snapshot.v1";

const BATTLE_EVENT_TYPES = new Set(["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"]);

export async function ingestSidecarEnvelope(envelope, options = {}) {
    const parsed = parseSidecarIngestEnvelope(envelope);

    if (parsed.kind === SIDECAR_BATTLE_EVENTS_KIND) {
        if (typeof options.appendBattleEvents !== "function") {
            return unavailableResult(options.battleUnavailablePayload, "Event store is unavailable for the active Community Mod variant gate.");
        }

        const normalizeBattleEvents = typeof options.normalizeBattleEvents === "function"
            ? options.normalizeBattleEvents
            : defaultNormalizeBattleEvents;
        const isDeveloperEvent = typeof options.isDeveloperEvent === "function"
            ? options.isDeveloperEvent
            : defaultIsDeveloperEvent;
        const developerModeRequiredPayload = typeof options.developerModeRequiredPayload === "function"
            ? options.developerModeRequiredPayload
            : defaultDeveloperModeRequiredPayload;
        const events = normalizeBattleEvents(parsed.payload);
        if (!Array.isArray(events) || events.length === 0) {
            throw new Error("battle.events payload must contain at least one recognized sidecar event.");
        }
        if (events.some((event) => !BATTLE_EVENT_TYPES.has(String(event?.type ?? "")))) {
            throw new Error("battle.events payload must contain only battle-log sidecar event types.");
        }
        if (!options.developerMode && events.some(isDeveloperEvent)) {
            return {
                statusCode: 403,
                body: {
                    ...developerModeRequiredPayload(),
                    error: "Developer mode is required to ingest runtime diagnostic events.",
                },
            };
        }

        const result = await options.appendBattleEvents(events, parsed);
        return {
            statusCode: 202,
            body: {
                ok: true,
                protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
                kind: parsed.kind,
                received: events.length,
                ...result,
            },
        };
    }

    if (typeof options.ingestFleetRuntimePayload !== "function") {
        return unavailableResult(options.fleetUnavailablePayload, "Fleet broker is unavailable.");
    }

    const result = await options.ingestFleetRuntimePayload(parsed.payload, parsed);
    return {
        statusCode: 202,
        body: {
            ok: true,
            protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
            kind: parsed.kind,
            ...result,
        },
    };
}

export function parseSidecarIngestEnvelope(value) {
    if (!isPlainObject(value)) {
        throw new Error("Sidecar ingest payload must be a JSON object.");
    }

    const protocolVersion = requiredString(value.protocolVersion, "protocolVersion");
    if (protocolVersion !== SIDECAR_INGEST_PROTOCOL_VERSION) {
        throw new Error(`Unsupported sidecar ingest protocolVersion '${protocolVersion}'.`);
    }

    const kind = requiredString(value.kind, "kind");
    if (kind !== SIDECAR_BATTLE_EVENTS_KIND && kind !== SIDECAR_FLEET_RUNTIME_KIND) {
        throw new Error(`Unsupported sidecar ingest kind '${kind}'.`);
    }

    const parsed = {
        protocolVersion,
        kind,
        batchId: requiredString(value.batchId, "batchId"),
        producedAt: requiredTimestamp(value.producedAt, "producedAt"),
        sessionId: requiredString(value.sessionId, "sessionId"),
        source: requiredString(value.source, "source"),
        modVersion: requiredString(value.modVersion, "modVersion"),
        payloadProtocol: requiredString(value.payloadProtocol, "payloadProtocol"),
        payload: value.payload,
    };

    if (parsed.kind === SIDECAR_BATTLE_EVENTS_KIND) {
        if (parsed.payloadProtocol !== SIDECAR_EVENTS_PROTOCOL_VERSION) {
            throw new Error(`battle.events requires payloadProtocol '${SIDECAR_EVENTS_PROTOCOL_VERSION}'.`);
        }
        if (!Array.isArray(parsed.payload)) {
            throw new Error("battle.events payload must be an array of sidecar events.");
        }
        if (parsed.payload.length === 0) {
            throw new Error("battle.events payload must contain at least one event.");
        }
        return parsed;
    }

    if (parsed.payloadProtocol !== SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION) {
        throw new Error(`fleet.runtime requires payloadProtocol '${SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION}'.`);
    }
    if (!isPlainObject(parsed.payload)) {
        throw new Error("fleet.runtime payload must be a fleet runtime snapshot object.");
    }
    if (parsed.payload.type !== SIDECAR_FLEET_RUNTIME_KIND) {
        throw new Error("fleet.runtime payload.type must be 'fleet.runtime'.");
    }
    if (parsed.payload.schemaVersion !== SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION) {
        throw new Error(`fleet.runtime payload.schemaVersion must be '${SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION}'.`);
    }
    if (!Array.isArray(parsed.payload.slots)) {
        throw new Error("fleet.runtime payload.slots must be an array.");
    }

    return parsed;
}

function unavailableResult(payloadOrFactory, fallbackError) {
    const payload = typeof payloadOrFactory === "function"
        ? payloadOrFactory()
        : payloadOrFactory;
    return {
        statusCode: 503,
        body: isPlainObject(payload)
            ? payload
            : { ok: false, error: fallbackError, retryAfterSeconds: 5 },
    };
}

function requiredString(value, fieldName) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
        throw new Error(`Sidecar ingest field '${fieldName}' is required.`);
    }
    return normalized;
}

function requiredTimestamp(value, fieldName) {
    const normalized = requiredString(value, fieldName);
    if (Number.isNaN(Date.parse(normalized))) {
        throw new Error(`Sidecar ingest field '${fieldName}' must be a valid timestamp.`);
    }
    return normalized;
}

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defaultNormalizeBattleEvents(payload) {
    return Array.isArray(payload) ? payload : [];
}

function defaultIsDeveloperEvent(event) {
    return ["debug.event", "hook.event", "session.event", "integration.event"].includes(String(event?.type ?? ""));
}

function defaultDeveloperModeRequiredPayload() {
    return { ok: false, error: "Developer mode required" };
}
