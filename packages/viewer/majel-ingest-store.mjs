const MAJEL_PROTOCOL_VERSION = "majel.ingest.v1";
const MAJEL_CLASSIFICATION = "cloud_private";
const DEFAULT_MAX_ENTRIES = 500;

export function createMajelIngestStore(options = {}) {
    const maxEntries = clampInteger(options.maxEntries, 1, 5000, DEFAULT_MAX_ENTRIES);
    const now = typeof options.now === "function" ? options.now : () => new Date();
    const entries = [];

    let acceptedCount = 0;
    let rejectedCount = 0;
    let nextLocalId = 1;
    let lastReceivedAt = null;
    let lastRejectedAt = null;
    let lastRejectedError = null;

    function ingest(payload) {
        const envelopes = Array.isArray(payload) ? payload : [payload];
        if (envelopes.length === 0) {
            return reject("Expected at least one Majel envelope.");
        }

        const validationResults = envelopes.map((envelope, index) => validateMajelEnvelope(envelope, index));
        const firstInvalid = validationResults.find((result) => !result.ok);
        if (firstInvalid) {
            return reject(firstInvalid.error);
        }

        const receivedAt = now().toISOString();
        const accepted = validationResults.map((result) => appendEnvelope(result.envelope, receivedAt));
        acceptedCount += accepted.length;
        lastReceivedAt = receivedAt;

        return {
            ok: true,
            status: "accepted",
            accepted: accepted.length,
            receivedAt,
            localIds: accepted.map((entry) => entry.localId),
            totalEnvelopes: acceptedCount,
            storedEnvelopes: entries.length,
            rejectedEnvelopes: rejectedCount,
        };
    }

    function reject(error) {
        rejectedCount += 1;
        lastRejectedAt = now().toISOString();
        lastRejectedError = error;
        return {
            ok: false,
            status: "rejected",
            error,
            rejectedAt: lastRejectedAt,
            totalEnvelopes: acceptedCount,
            storedEnvelopes: entries.length,
            rejectedEnvelopes: rejectedCount,
        };
    }

    function appendEnvelope(envelope, receivedAt) {
        const localId = nextLocalId;
        nextLocalId += 1;

        const rawJson = JSON.stringify(envelope);
        const entry = {
            localId,
            receivedAt,
            envelope,
            rawJson,
            envelopeBytes: Buffer.byteLength(rawJson, "utf8"),
            payloadBytes: Buffer.byteLength(JSON.stringify(envelope.payload ?? null), "utf8"),
            summary: summarizeEnvelope(envelope),
        };

        entries.unshift(entry);
        if (entries.length > maxEntries) {
            entries.length = maxEntries;
        }

        return entry;
    }

    function snapshot(limit = DEFAULT_MAX_ENTRIES) {
        const resolvedLimit = clampInteger(limit, 10, maxEntries, Math.min(150, maxEntries));
        const visibleEntries = entries.slice(0, resolvedLimit);
        return {
            ok: true,
            source: "majel-ingest-memory",
            endpoint: "/api/majel/ingest",
            generatedAt: now().toISOString(),
            maxEntries,
            totalEnvelopes: acceptedCount,
            storedEnvelopes: entries.length,
            returnedEnvelopes: visibleEntries.length,
            rejectedEnvelopes: rejectedCount,
            lastReceivedAt,
            lastRejectedAt,
            lastRejectedError,
            events: visibleEntries.map(summarizeEntry),
        };
    }

    function detail(localId) {
        const resolvedLocalId = Number.parseInt(String(localId ?? ""), 10);
        if (!Number.isFinite(resolvedLocalId)) {
            return null;
        }

        const entry = entries.find((item) => item.localId === resolvedLocalId);
        if (!entry) {
            return null;
        }

        return {
            ok: true,
            source: "majel-ingest-memory",
            generatedAt: now().toISOString(),
            event: {
                localId: entry.localId,
                receivedAt: entry.receivedAt,
                envelopeBytes: entry.envelopeBytes,
                payloadBytes: entry.payloadBytes,
                summary: entry.summary,
                envelope: entry.envelope,
                rawJson: entry.rawJson,
            },
        };
    }

    return {
        ingest,
        snapshot,
        detail,
        recordRejected: reject,
        validate: validateMajelEnvelope,
    };
}

export function validateMajelEnvelope(value, index = 0) {
    const prefix = `Item ${index + 1}`;
    if (!isRecord(value)) {
        return { ok: false, error: `${prefix} is not an object.` };
    }

    const requiredTextFields = [
        "eventId",
        "source",
        "sourceVersion",
        "installId",
        "sessionId",
        "observedAt",
        "schema",
        "classification",
    ];

    if (value.protocolVersion !== MAJEL_PROTOCOL_VERSION) {
        return { ok: false, error: `${prefix} must use protocolVersion ${MAJEL_PROTOCOL_VERSION}.` };
    }

    for (const field of requiredTextFields) {
        if (typeof value[field] !== "string" || value[field].trim() === "") {
            return { ok: false, error: `${prefix} must include non-empty string field ${field}.` };
        }
    }

    if (value.classification !== MAJEL_CLASSIFICATION) {
        return { ok: false, error: `${prefix} must use classification ${MAJEL_CLASSIFICATION}.` };
    }

    if (!Number.isInteger(value.sequence) || value.sequence < 0) {
        return { ok: false, error: `${prefix} must include a non-negative integer sequence.` };
    }

    if (Number.isNaN(Date.parse(value.observedAt))) {
        return { ok: false, error: `${prefix} must include an ISO-compatible observedAt timestamp.` };
    }

    if (!isRecord(value.payload) && !Array.isArray(value.payload)) {
        return { ok: false, error: `${prefix} must include an object or array payload.` };
    }

    return { ok: true, envelope: value };
}

function summarizeEntry(entry) {
    return {
        localId: entry.localId,
        receivedAt: entry.receivedAt,
        envelopeBytes: entry.envelopeBytes,
        payloadBytes: entry.payloadBytes,
        summary: entry.summary,
    };
}

function summarizeEnvelope(envelope) {
    return {
        title: envelope.schema,
        subtitle: `${envelope.source} ${envelope.sourceVersion}`,
        chips: [
            `seq ${envelope.sequence}`,
            envelope.classification,
            envelope.installId,
        ].filter(Boolean),
        schema: envelope.schema,
        source: envelope.source,
        sourceVersion: envelope.sourceVersion,
        installId: envelope.installId,
        sessionId: envelope.sessionId,
        eventId: envelope.eventId,
        sequence: envelope.sequence,
        observedAt: envelope.observedAt,
        classification: envelope.classification,
    };
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInteger(value, min, max, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, min), max);
}
