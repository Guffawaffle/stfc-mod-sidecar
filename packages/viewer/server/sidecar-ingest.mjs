export const SIDECAR_INGEST_PROTOCOL_VERSION = "stfc.sidecar.ingest.v1";
export const SIDECAR_BATTLE_EVENTS_KIND = "battle.events";
export const SIDECAR_OBSERVED_HOSTILES_KIND = "observed.hostiles";
export const SIDECAR_FLEET_ALERT_EVIDENCE_KIND = "fleet.alert_evidence";
export const SIDECAR_FLEET_RUNTIME_KIND = "fleet.runtime";
export const SIDECAR_TRANSPORT_CHUNK_KIND = "transport.chunk";
export const SIDECAR_EVENTS_PROTOCOL_VERSION = "stfc.sidecar.events.v0";
export const SIDECAR_BATTLE_EVENTS_PROTOCOL_VERSION = SIDECAR_EVENTS_PROTOCOL_VERSION;
export const SIDECAR_OBSERVED_HOSTILES_PROTOCOL_VERSION = SIDECAR_EVENTS_PROTOCOL_VERSION;
export const SIDECAR_FLEET_ALERT_EVIDENCE_PROTOCOL_VERSION = SIDECAR_EVENTS_PROTOCOL_VERSION;
export const SIDECAR_FLEET_RUNTIME_PROTOCOL_VERSION = "stfc.fleet.runtime_snapshot.v1";
export const SIDECAR_TRANSPORT_CHUNK_PROTOCOL_VERSION = "stfc.sidecar.ingest.chunk.v1";

const BATTLE_EVENT_TYPES = new Set(["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"]);
const OBSERVED_HOSTILE_EVENT_TYPES = new Set(["observed.hostile"]);
const FLEET_ALERT_EVIDENCE_EVENT_TYPES = new Set(["fleet.alert_evidence"]);
const TRANSPORT_CHUNK_ENCODING = "base64";
const DEFAULT_TRANSPORT_CHUNK_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_TRANSPORT_CHUNK_MAX_REASSEMBLED_BYTES = 32 * 1024 * 1024;
const defaultChunkAssembler = createSidecarChunkAssembler();

export async function ingestSidecarEnvelope(envelope, options = {}) {
    const parsed = parseSidecarIngestEnvelope(envelope);

    if (parsed.kind === SIDECAR_TRANSPORT_CHUNK_KIND) {
        const chunkAssembler = options.chunkAssembler && typeof options.chunkAssembler.accept === "function"
            ? options.chunkAssembler
            : defaultChunkAssembler;
        const chunkResult = chunkAssembler.accept(parsed);
        if (!chunkResult.complete) {
            return {
                statusCode: 202,
                body: {
                    ok: true,
                    protocolVersion: SIDECAR_INGEST_PROTOCOL_VERSION,
                    kind: parsed.kind,
                    chunked: true,
                    chunkGroupId: chunkResult.chunkGroupId,
                    chunkCount: chunkResult.chunkCount,
                    receivedChunks: chunkResult.receivedChunks,
                    pendingChunks: chunkResult.pendingChunks,
                    reassembled: false,
                },
            };
        }

        const reassembledResult = await ingestSidecarEnvelope(chunkResult.envelope, {
            ...options,
            chunkAssembler,
        });
        return {
            statusCode: reassembledResult.statusCode,
            body: {
                ...reassembledResult.body,
                chunked: true,
                transportKind: SIDECAR_TRANSPORT_CHUNK_KIND,
                chunkGroupId: chunkResult.chunkGroupId,
                chunkCount: chunkResult.chunkCount,
                reassembledBytes: chunkResult.totalBytes,
            },
        };
    }

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

    if (parsed.kind === SIDECAR_OBSERVED_HOSTILES_KIND) {
        if (typeof options.appendObservedHostileEvents !== "function") {
            return unavailableResult(options.observedHostilesUnavailablePayload, "Observed hostile storage is unavailable.");
        }

        const normalizeObservedHostileEvents = typeof options.normalizeObservedHostileEvents === "function"
            ? options.normalizeObservedHostileEvents
            : defaultNormalizeBattleEvents;
        const events = normalizeObservedHostileEvents(parsed.payload);
        if (!Array.isArray(events) || events.length === 0) {
            throw new Error("observed.hostiles payload must contain at least one recognized sidecar event.");
        }
        if (events.some((event) => !OBSERVED_HOSTILE_EVENT_TYPES.has(String(event?.type ?? "")))) {
            throw new Error("observed.hostiles payload must contain only observed.hostile sidecar event types.");
        }

        const result = await options.appendObservedHostileEvents(events, parsed);
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

    if (parsed.kind === SIDECAR_FLEET_ALERT_EVIDENCE_KIND) {
        if (typeof options.appendFleetAlertEvidenceEvents !== "function") {
            return unavailableResult(options.fleetAlertEvidenceUnavailablePayload, "Fleet alert evidence storage is unavailable.");
        }

        const normalizeFleetAlertEvidenceEvents = typeof options.normalizeFleetAlertEvidenceEvents === "function"
            ? options.normalizeFleetAlertEvidenceEvents
            : defaultNormalizeBattleEvents;
        const events = normalizeFleetAlertEvidenceEvents(parsed.payload);
        if (!Array.isArray(events) || events.length === 0) {
            throw new Error("fleet.alert_evidence payload must contain at least one recognized sidecar event.");
        }
        if (events.some((event) => !FLEET_ALERT_EVIDENCE_EVENT_TYPES.has(String(event?.type ?? "")))) {
            throw new Error("fleet.alert_evidence payload must contain only fleet.alert_evidence sidecar event types.");
        }

        const result = await options.appendFleetAlertEvidenceEvents(events, parsed);
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
    if (kind !== SIDECAR_BATTLE_EVENTS_KIND
        && kind !== SIDECAR_OBSERVED_HOSTILES_KIND
        && kind !== SIDECAR_FLEET_ALERT_EVIDENCE_KIND
        && kind !== SIDECAR_FLEET_RUNTIME_KIND
        && kind !== SIDECAR_TRANSPORT_CHUNK_KIND) {
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

    if (parsed.kind === SIDECAR_TRANSPORT_CHUNK_KIND) {
        if (parsed.payloadProtocol !== SIDECAR_TRANSPORT_CHUNK_PROTOCOL_VERSION) {
            throw new Error(`transport.chunk requires payloadProtocol '${SIDECAR_TRANSPORT_CHUNK_PROTOCOL_VERSION}'.`);
        }
        if (!isPlainObject(parsed.payload)) {
            throw new Error("transport.chunk payload must be an object.");
        }

        const chunkPayload = {
            schemaVersion: requiredString(parsed.payload.schemaVersion, "payload.schemaVersion"),
            chunkGroupId: requiredString(parsed.payload.chunkGroupId, "payload.chunkGroupId"),
            chunkIndex: requiredInteger(parsed.payload.chunkIndex, "payload.chunkIndex", { min: 0 }),
            chunkCount: requiredInteger(parsed.payload.chunkCount, "payload.chunkCount", { min: 1 }),
            totalBytes: requiredInteger(parsed.payload.totalBytes, "payload.totalBytes", { min: 1 }),
            originalKind: requiredString(parsed.payload.originalKind, "payload.originalKind"),
            originalBatchId: requiredString(parsed.payload.originalBatchId, "payload.originalBatchId"),
            chunkEncoding: requiredString(parsed.payload.chunkEncoding, "payload.chunkEncoding"),
            chunkBase64: requiredString(parsed.payload.chunkBase64, "payload.chunkBase64"),
        };
        if (chunkPayload.schemaVersion !== SIDECAR_TRANSPORT_CHUNK_PROTOCOL_VERSION) {
            throw new Error(`transport.chunk payload.schemaVersion must be '${SIDECAR_TRANSPORT_CHUNK_PROTOCOL_VERSION}'.`);
        }
        if (chunkPayload.chunkIndex >= chunkPayload.chunkCount) {
            throw new Error("transport.chunk payload.chunkIndex must be less than chunkCount.");
        }
        if (chunkPayload.chunkEncoding !== TRANSPORT_CHUNK_ENCODING) {
            throw new Error(`transport.chunk payload.chunkEncoding must be '${TRANSPORT_CHUNK_ENCODING}'.`);
        }

        return {
            ...parsed,
            payload: chunkPayload,
        };
    }

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

    if (parsed.kind === SIDECAR_OBSERVED_HOSTILES_KIND) {
        if (parsed.payloadProtocol !== SIDECAR_EVENTS_PROTOCOL_VERSION) {
            throw new Error(`observed.hostiles requires payloadProtocol '${SIDECAR_EVENTS_PROTOCOL_VERSION}'.`);
        }
        if (!Array.isArray(parsed.payload)) {
            throw new Error("observed.hostiles payload must be an array of sidecar events.");
        }
        if (parsed.payload.length === 0) {
            throw new Error("observed.hostiles payload must contain at least one event.");
        }
        return parsed;
    }

    if (parsed.kind === SIDECAR_FLEET_ALERT_EVIDENCE_KIND) {
        if (parsed.payloadProtocol !== SIDECAR_EVENTS_PROTOCOL_VERSION) {
            throw new Error(`fleet.alert_evidence requires payloadProtocol '${SIDECAR_EVENTS_PROTOCOL_VERSION}'.`);
        }
        if (!Array.isArray(parsed.payload)) {
            throw new Error("fleet.alert_evidence payload must be an array of sidecar events.");
        }
        if (parsed.payload.length === 0) {
            throw new Error("fleet.alert_evidence payload must contain at least one event.");
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

export function createSidecarChunkAssembler({
    maxPendingAgeMs = DEFAULT_TRANSPORT_CHUNK_PENDING_MAX_AGE_MS,
    maxReassembledBytes = DEFAULT_TRANSPORT_CHUNK_MAX_REASSEMBLED_BYTES,
} = {}) {
    const pendingGroups = new Map();

    function pruneExpired(nowMs) {
        for (const [chunkGroupId, state] of pendingGroups.entries()) {
            if (nowMs - state.updatedAtMs >= maxPendingAgeMs) {
                pendingGroups.delete(chunkGroupId);
            }
        }
    }

    function failChunkGroup(chunkGroupId, message) {
        pendingGroups.delete(chunkGroupId);
        throw new Error(message);
    }

    return {
        accept(parsedEnvelope) {
            if (parsedEnvelope?.kind !== SIDECAR_TRANSPORT_CHUNK_KIND) {
                throw new Error("Chunk assembler accepts only transport.chunk envelopes.");
            }

            const nowMs = Date.now();
            pruneExpired(nowMs);

            const chunk = parsedEnvelope.payload;
            if (chunk.totalBytes > maxReassembledBytes) {
                throw new Error(`transport.chunk group '${chunk.chunkGroupId}' exceeds ${maxReassembledBytes} bytes.`);
            }

            const chunkBytes = decodeBase64Chunk(chunk.chunkBase64);
            let state = pendingGroups.get(chunk.chunkGroupId);
            if (!state) {
                state = {
                    chunkCount: chunk.chunkCount,
                    totalBytes: chunk.totalBytes,
                    originalKind: chunk.originalKind,
                    originalBatchId: chunk.originalBatchId,
                    updatedAtMs: nowMs,
                    chunks: Array.from({ length: chunk.chunkCount }, () => null),
                    receivedChunks: 0,
                    receivedBytes: 0,
                };
                pendingGroups.set(chunk.chunkGroupId, state);
            } else {
                state.updatedAtMs = nowMs;
                if (state.chunkCount !== chunk.chunkCount
                    || state.totalBytes !== chunk.totalBytes
                    || state.originalKind !== chunk.originalKind
                    || state.originalBatchId !== chunk.originalBatchId) {
                    failChunkGroup(chunk.chunkGroupId, `transport.chunk group '${chunk.chunkGroupId}' changed metadata mid-stream.`);
                }
            }

            const existingChunk = state.chunks[chunk.chunkIndex];
            if (existingChunk) {
                if (!existingChunk.equals(chunkBytes)) {
                    failChunkGroup(
                        chunk.chunkGroupId,
                        `transport.chunk group '${chunk.chunkGroupId}' received conflicting data for chunk ${chunk.chunkIndex}.`,
                    );
                }
            } else {
                state.chunks[chunk.chunkIndex] = chunkBytes;
                state.receivedChunks += 1;
                state.receivedBytes += chunkBytes.length;
                if (state.receivedBytes > state.totalBytes) {
                    failChunkGroup(
                        chunk.chunkGroupId,
                        `transport.chunk group '${chunk.chunkGroupId}' exceeded declared totalBytes ${state.totalBytes}.`,
                    );
                }
            }

            const pendingChunks = state.chunkCount - state.receivedChunks;
            if (pendingChunks > 0) {
                return {
                    complete: false,
                    chunkGroupId: chunk.chunkGroupId,
                    chunkCount: state.chunkCount,
                    receivedChunks: state.receivedChunks,
                    pendingChunks,
                };
            }

            const reassembledBuffer = Buffer.concat(state.chunks);
            pendingGroups.delete(chunk.chunkGroupId);
            if (reassembledBuffer.length !== state.totalBytes) {
                throw new Error(
                    `transport.chunk group '${chunk.chunkGroupId}' reassembled ${reassembledBuffer.length} bytes, expected ${state.totalBytes}.`,
                );
            }

            let reassembledEnvelope;
            try {
                reassembledEnvelope = JSON.parse(reassembledBuffer.toString("utf8"));
            } catch (error) {
                throw new Error(
                    `transport.chunk group '${chunk.chunkGroupId}' reassembled invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
                );
            }

            if (!isPlainObject(reassembledEnvelope)) {
                throw new Error(`transport.chunk group '${chunk.chunkGroupId}' must reassemble to a JSON object.`);
            }
            if (String(reassembledEnvelope.kind ?? "") !== state.originalKind) {
                throw new Error(
                    `transport.chunk group '${chunk.chunkGroupId}' reassembled kind '${String(reassembledEnvelope.kind ?? "")}', expected '${state.originalKind}'.`,
                );
            }
            if (String(reassembledEnvelope.batchId ?? "") !== state.originalBatchId) {
                throw new Error(
                    `transport.chunk group '${chunk.chunkGroupId}' reassembled batchId '${String(reassembledEnvelope.batchId ?? "")}', expected '${state.originalBatchId}'.`,
                );
            }

            return {
                complete: true,
                envelope: reassembledEnvelope,
                chunkGroupId: chunk.chunkGroupId,
                chunkCount: state.chunkCount,
                totalBytes: state.totalBytes,
            };
        },
        reset() {
            pendingGroups.clear();
        },
    };
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

function requiredInteger(value, fieldName, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`Sidecar ingest field '${fieldName}' must be an integer.`);
    }
    return value;
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

function decodeBase64Chunk(value) {
    const normalized = String(value ?? "").trim();
    if (!normalized || normalized.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(normalized)) {
        throw new Error("transport.chunk payload.chunkBase64 must be standard base64.");
    }

    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length === 0) {
        throw new Error("transport.chunk payload.chunkBase64 must decode to at least one byte.");
    }

    return decoded;
}
