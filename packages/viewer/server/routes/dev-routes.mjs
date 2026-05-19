import { sendJson } from "../static-files.mjs";

export async function handleDevRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/dev/ax") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        sendJson(response, 200, await context.readAxPackage(requestUrl));
        return true;
    }

    if (requestUrl.pathname === "/api/dev/status") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        sendJson(response, 200, {
            ok: true,
            developerMode: context.developerMode,
            companionMode: context.companionMode,
            modProfile: context.communityModSettingsProfile,
            settingsProfile: context.communityModSettingsProfile,
            capabilities: context.getCommunityModCapabilities(),
            capabilityBits: context.communityModVariantGate.capabilityBits,
            variantGate: context.communityModVariantGate,
            feedPath: context.feedPath,
            settingsPath: context.settingsPath,
            eventStoreBackend: context.getEventStoreBackend(),
            cloudTelemetry: context.cloudTelemetryBridge.status(),
            fleetBroker: await context.readFleetBrokerSummary(),
            generatedAt: new Date().toISOString(),
        });
        return true;
    }

    return false;
}