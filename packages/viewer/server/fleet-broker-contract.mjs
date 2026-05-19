const LEGACY_FLEET_SYNC_BATCH_SIZE = 100;

export function buildCompatibleFleetSyncSuccessPayload(result, options = {}) {
    const accepted = Number(result.accepted ?? 0);
    const queued = Number.isFinite(options.queued)
        ? Math.max(0, options.queued)
        : Math.max(0, Number(result.outboxInserted ?? 0) + Number(result.outboxUpdated ?? 0));
    const queueDepth = Number.isFinite(options.queueDepth) ? Math.max(0, options.queueDepth) : 0;

    return {
        ...result,
        batches: accepted > 0 ? Math.ceil(accepted / LEGACY_FLEET_SYNC_BATCH_SIZE) : 0,
        queued,
        uploadEnabled: false,
        endpointConfigured: false,
        queueDepth,
    };
}

export function buildUnavailableFleetBrokerSummary(options = {}) {
    const now = typeof options.now === "function" ? options.now : () => new Date();
    const summarizeError = typeof options.summarizeError === "function"
        ? options.summarizeError
        : defaultSummarizeError;

    return {
        available: false,
        backend: "none",
        cloudUploadEnabled: false,
        rawEventCount: 0,
        pendingOutboxCount: 0,
        projectionCount: 0,
        latestSequence: 0,
        lastObservedAt: null,
        lastProjectedAt: null,
        lastError: options.error ? summarizeError(options.error) : null,
        lastErrorAt: options.error ? now().toISOString() : null,
    };
}

function defaultSummarizeError(error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return message.slice(0, 240);
}