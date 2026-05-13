import { sendJson } from "../static-files.mjs";

export async function handleSettingsRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/settings/hotkeys") {
        if (request.method === "GET") {
            sendJson(response, 200, await context.readHotkeySettingsSnapshot());
            return true;
        }

        if (isSettingsWriteMethod(request.method)) {
            await context.handleHotkeySettingsUpdate(request, response);
            return true;
        }

        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    if (requestUrl.pathname === "/api/settings/notifications") {
        if (request.method === "GET") {
            sendJson(response, 200, await context.readNotificationSettingsSnapshot());
            return true;
        }

        if (isSettingsWriteMethod(request.method)) {
            await context.handleNotificationSettingsUpdate(request, response);
            return true;
        }

        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    if (requestUrl.pathname === "/api/settings/diagnostics") {
        if (!context.developerMode) {
            sendJson(response, 403, context.developerModeRequiredPayload());
            return true;
        }

        if (request.method === "GET") {
            sendJson(response, 200, await context.readDiagnosticSettingsSnapshot());
            return true;
        }

        if (isSettingsWriteMethod(request.method)) {
            await context.handleDiagnosticSettingsUpdate(request, response);
            return true;
        }

        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    return false;
}

function isSettingsWriteMethod(method) {
    return method === "PUT" || method === "PATCH" || method === "POST";
}
