import { createHash, randomUUID } from "node:crypto";

const PROTOCOL_VERSION = "stfc.telemetry.v1";
const MAX_BATCH_EVENTS = 100;
const MAX_SNAPSHOT_SLOTS = 20;
const MAX_QUEUE_BATCHES = 200;
const SOURCE = "stfc-sidecar";

export function createCloudTelemetryBridge(options = {}) {
    const env = options.env ?? process.env;
    const logger = options.logger ?? console;
    const now = options.now ?? (() => new Date());
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const endpoint = normalizeEndpoint(env.STFC_SIDECAR_CLOUD_TELEMETRY_URL ?? env.MAJEL_SIDECAR_TELEMETRY_URL);
    const token = String(env.STFC_SIDECAR_CLOUD_TELEMETRY_TOKEN ?? env.MAJEL_SIDECAR_TELEMETRY_TOKEN ?? "").trim();
    const installId = normalizeIdentifier(env.STFC_SIDECAR_INSTALL_ID) || `sidecar-${shaHex(options.gameDir ?? "default-install").slice(0, 32)}`;
    const sessionId = normalizeIdentifier(env.STFC_SIDECAR_SESSION_ID) || `session-${Date.now()}`;
    const sidecarVersion = normalizeIdentifier(options.sidecarVersion) || "unknown";
    const uploadEnabled = Boolean(endpoint && token && fetchImpl);
    const queue = [];
    const stats = {
        acceptedEvents: 0,
        queuedBatches: 0,
        uploadedBatches: 0,
        uploadedEvents: 0,
        failedBatches: 0,
        droppedBatches: 0,
        deadBatches: 0,
        lastAcceptedAt: null,
        lastUploadAt: null,
        lastErrorAt: null,
        lastError: "",
    };
    let sequence = 0;
    let draining = false;
    let retryTimer = null;

    function ingestSyncPayload(payload) {
        const items = normalizeSyncPayload(payload);
        const acceptedAt = now().toISOString();
        const events = buildTelemetryEvents(items, {
            installId,
            sessionId,
            sidecarVersion,
            timestamp: acceptedAt,
            nextSequence: () => {
                sequence += 1;
                return sequence;
            },
        });

        stats.acceptedEvents += events.length;
        stats.lastAcceptedAt = acceptedAt;

        const batches = chunk(events, MAX_BATCH_EVENTS).map((batchEvents) => ({
            attempts: 0,
            nextAttemptAt: 0,
            batch: {
                batchId: `batch-${randomUUID()}`,
                sentAt: now().toISOString(),
                events: batchEvents,
            },
        }));

        if (uploadEnabled) {
            for (const item of batches) {
                enqueueBatch(item);
            }
            scheduleDrain(0);
        }

        return {
            ok: true,
            protocolVersion: PROTOCOL_VERSION,
            received: items.length,
            accepted: events.length,
            batches: batches.length,
            queued: uploadEnabled ? batches.length : 0,
            uploadEnabled,
            endpointConfigured: Boolean(endpoint),
            queueDepth: queue.length,
        };
    }

    function status() {
        return {
            protocolVersion: PROTOCOL_VERSION,
            uploadEnabled,
            endpointConfigured: Boolean(endpoint),
            tokenConfigured: Boolean(token),
            queueDepth: queue.length,
            ...stats,
        };
    }

    function enqueueBatch(item) {
        while (queue.length >= MAX_QUEUE_BATCHES) {
            queue.shift();
            stats.droppedBatches += 1;
        }
        queue.push(item);
        stats.queuedBatches += 1;
    }

    function scheduleDrain(delayMs) {
        if (!uploadEnabled || draining || retryTimer) {
            return;
        }
        retryTimer = setTimeout(() => {
            retryTimer = null;
            void drainQueue();
        }, Math.max(0, delayMs));
        retryTimer.unref?.();
    }

    async function drainQueue() {
        if (draining || !uploadEnabled) {
            return;
        }

        draining = true;
        try {
            while (queue.length > 0) {
                const item = queue[0];
                const waitMs = item.nextAttemptAt - Date.now();
                if (waitMs > 0) {
                    scheduleDrain(waitMs);
                    return;
                }

                try {
                    const response = await fetchImpl(endpoint, {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify(item.batch),
                    });

                    if (!response.ok) {
                        throw new Error(`telemetry upload returned HTTP ${response.status}`);
                    }

                    queue.shift();
                    stats.uploadedBatches += 1;
                    stats.uploadedEvents += item.batch.events.length;
                    stats.lastUploadAt = now().toISOString();
                    stats.lastError = "";
                } catch (error) {
                    item.attempts += 1;
                    stats.failedBatches += 1;
                    stats.lastErrorAt = now().toISOString();
                    stats.lastError = error instanceof Error ? error.message : String(error);

                    if (item.attempts >= 5) {
                        queue.shift();
                        stats.deadBatches += 1;
                        logger.warn?.(`[sidecar-telemetry] dropping failed batch after ${item.attempts} attempts`);
                        continue;
                    }

                    const backoffMs = Math.min(30_000, 500 * 2 ** (item.attempts - 1));
                    item.nextAttemptAt = Date.now() + backoffMs;
                    logger.warn?.(`[sidecar-telemetry] upload failed; retrying in ${backoffMs}ms`);
                    scheduleDrain(backoffMs);
                    return;
                }
            }
        } finally {
            draining = false;
            if (queue.length > 0) {
                scheduleDrain(Math.max(0, queue[0].nextAttemptAt - Date.now()));
            }
        }
    }

    return { ingestSyncPayload, status };
}

function normalizeSyncPayload(payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    return items.filter((item) => isRecord(item) && (item.type === "ship" || item.type === "slot"));
}

function buildTelemetryEvents(items, context) {
    const ships = items.filter((item) => item.type === "ship");
    const slots = items.filter((item) => item.type === "slot");
    const events = [];

    for (const shipChunk of chunk(ships, MAX_SNAPSHOT_SLOTS)) {
        const telemetrySlots = shipChunk.map((ship) => shipSyncItemToSlot(ship, context.timestamp)).filter(Boolean);
        if (telemetrySlots.length === 0) {
            continue;
        }

        const version = context.nextSequence();
        events.push(baseEvent("fleet.snapshot", "stfc.telemetry.fleet-snapshot.v1", context, version, {
            snapshotId: `ships-${version}`,
            snapshotVersion: version,
            observedAt: context.timestamp,
            sidecarVersion: context.sidecarVersion,
            fleetCount: telemetrySlots.length,
            slots: telemetrySlots,
            capabilities: { fleetProjection: true, battleSummary: true },
            coalesceKey: `${context.installId}:fleet.snapshot:${context.sessionId}`,
        }));
    }

    for (const slot of slots) {
        const event = slotSyncItemToEvent(slot, context);
        if (event) {
            events.push(event);
        }
    }

    return events;
}

function baseEvent(type, schemaVersion, context, version, fields) {
    return {
        protocolVersion: PROTOCOL_VERSION,
        schemaVersion,
        type,
        timestamp: context.timestamp,
        installId: context.installId,
        sessionId: context.sessionId,
        source: SOURCE,
        classification: "cloud_private",
        idempotencyKey: `sidecar:${type}:${shaHex(`${context.installId}:${context.sessionId}:${type}:${version}:${context.timestamp}`).slice(0, 48)}`,
        ...fields,
    };
}

function shipSyncItemToSlot(ship, timestamp) {
    const shipId = finiteNumber(ship.psid);
    if (shipId === null) {
        return null;
    }

    const hullId = finiteNumber(ship.hull_id);
    const level = finiteNumber(ship.level);
    const tier = finiteNumber(ship.tier);
    const shipKeyHash = shaHex(`ship:${shipId}`).slice(0, 32);
    const fleetKey = `fleet-${shipKeyHash.slice(0, 16)}`;
    const slot = {
        slotKey: `ship-${shipKeyHash.slice(0, 16)}`,
        fleetKey,
        shipKeyHash,
        state: "observed",
        assignmentKind: "player_ship",
        updatedAt: timestamp,
    };

    if (hullId !== null) {
        slot.shipType = `hull:${hullId}`;
    }
    if (level !== null) {
        slot.levelBand = levelBand(level);
    }
    if (tier !== null) {
        slot.healthBand = `tier:${tier}`;
    }

    return slot;
}

function slotSyncItemToEvent(slot, context) {
    const slotId = finiteNumber(slot.sid);
    if (slotId === null) {
        return null;
    }

    const version = context.nextSequence();
    const slotHash = shaHex(`slot:${slotId}`).slice(0, 24);
    const itemId = finiteNumber(slot.item_id);
    const currentState = itemId === null || itemId < 0 ? "empty" : "assigned";
    const slotType = finiteNumber(slot.slot_type);
    return baseEvent("fleet.slot.changed", "stfc.telemetry.fleet-slot-changed.v1", context, version, {
        slotKey: `slot-${slotHash}`,
        fleetKey: `slot-${slotHash}`,
        currentState,
        assignmentKind: slotType === null ? "slot" : `slot-type:${slotType}`,
        observedAt: context.timestamp,
        stateVersion: version,
        coalesceKey: `${context.installId}:fleet.slot:slot-${slotHash}`,
    });
}

function levelBand(level) {
    if (level <= 9) {
        return "1-9";
    }
    const start = Math.floor(level / 10) * 10;
    return `${start}-${start + 9}`;
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function normalizeEndpoint(value) {
    const endpoint = String(value ?? "").trim();
    return endpoint ? endpoint.replace(/\/+$/, "") : "";
}

function normalizeIdentifier(value) {
    const candidate = String(value ?? "").trim();
    return /^[A-Za-z0-9._:-]{1,256}$/.test(candidate) ? candidate : "";
}

function shaHex(value) {
    return createHash("sha256").update(String(value)).digest("hex");
}

function chunk(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}