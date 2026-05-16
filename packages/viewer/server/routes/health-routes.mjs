import { sendJson } from "../static-files.mjs";

export async function handleHealthRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/health/ready") {
        sendJson(response, 200, {
            ok: true,
            pid: context.process.pid,
            port: context.port,
            desktop: context.process.env.STFC_SIDECAR_DESKTOP === "1",
            developerMode: context.developerMode,
            companionMode: context.companionMode,
            modProfile: context.communityModSettingsProfile,
            settingsProfile: context.communityModSettingsProfile,
            eventStoreBackend: context.getEventStoreBackend(),
            startedAt: context.startedAt.toISOString(),
            uptimeMs: Date.now() - context.startedAt.getTime(),
            shuttingDown: context.isShutdownRequested(),
            pollHintMs: context.pollHintMs,
            generatedAt: new Date().toISOString(),
        });
        return true;
    }

    if (requestUrl.pathname === "/api/health") {
        const { install: communityModInstall, variantGate } = await context.refreshCommunityModVariantGate();
        const storedEvents = await context.countStoredEvents();
        sendJson(response, 200, {
            ok: true,
            pid: context.process.pid,
            gameDir: context.gameDir,
            feedPath: context.feedPath,
            settingsPath: context.settingsPath,
            port: context.port,
            desktop: context.process.env.STFC_SIDECAR_DESKTOP === "1",
            defaultLimit: context.defaultLimit,
            developerMode: context.developerMode,
            companionMode: context.companionMode,
            modProfile: context.communityModSettingsProfile,
            settingsProfile: context.communityModSettingsProfile,
            capabilities: context.getCommunityModCapabilities(),
            capabilityBits: variantGate.capabilityBits,
            variantGate,
            communityModInstall,
            release: context.releaseInfo,
            eventStoreBackend: context.getEventStoreBackend(),
            storedEvents,
            cloudTelemetry: context.cloudTelemetryBridge.status(),
            startedAt: context.startedAt.toISOString(),
            uptimeMs: Date.now() - context.startedAt.getTime(),
            shuttingDown: context.isShutdownRequested(),
            pollHintMs: context.pollHintMs,
            generatedAt: new Date().toISOString(),
        });
        return true;
    }

    if (requestUrl.pathname === "/api/admin/shutdown") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        if (!context.shutdownToken) {
            sendJson(response, 403, { ok: false, error: "Shutdown control is disabled for this process" });
            return true;
        }

        if (!context.isAuthorizedShutdownRequest(request)) {
            sendJson(response, 401, { ok: false, error: "Unauthorized shutdown request" });
            return true;
        }

        sendJson(response, 202, {
            ok: true,
            pid: context.process.pid,
            shuttingDown: true,
        });
        setImmediate(() => {
            void context.shutdownServer("admin_request");
        });
        return true;
    }

    return false;
}
