export function shouldNotifyFleetProjectionChanged(brokerResult) {
    return Number(brokerResult?.projectionAdvanced ?? 0) > 0;
}

export function fleetProjectionStreamSummary(readProjectionResult) {
    const projection = readProjectionResult?.projection;
    if (!readProjectionResult?.ok || !projection) {
        return null;
    }

    return {
        stateVersion: projection.stateVersion,
        stateHash: projection.stateHash,
        observedAt: projection.observedAt,
        updatedAt: projection.updatedAt,
        slotCount: projection.slotCount,
    };
}
