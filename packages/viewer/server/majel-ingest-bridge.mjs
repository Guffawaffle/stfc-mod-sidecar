export async function ingestAcceptedMajelPayload(options) {
    const majelResult = options.majelIngestStore.ingest(options.payload);
    if (!majelResult.ok) {
        return {
            majelResult,
            fleetBrokerResult: null,
            bridgeError: null,
        };
    }

    if (!options.fleetBroker || options.countFleetRuntimeMajelEnvelopes(options.payload) <= 0) {
        return {
            majelResult,
            fleetBrokerResult: null,
            bridgeError: null,
        };
    }

    try {
        return {
            majelResult,
            fleetBrokerResult: await options.fleetBroker.ingestFleetRuntimePayload(options.payload),
            bridgeError: null,
        };
    } catch (bridgeError) {
        return {
            majelResult,
            fleetBrokerResult: null,
            bridgeError,
        };
    }
}