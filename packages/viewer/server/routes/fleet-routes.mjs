import { sendJson } from "../static-files.mjs";
import { resolveFleetActivityLimit } from "../fleet-activity.mjs";

const DEFAULT_ALERT_INTENT_LIMIT = 25;
const MAX_ALERT_INTENT_LIMIT = 100;

export async function handleFleetRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/fleet/sync") {
        if (request.method === "POST") {
            await context.handleFleetSyncIngest(request, response);
            return true;
        }

        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    if (requestUrl.pathname === "/api/fleet/activity") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const activity = await context.readFleetActivity(resolveFleetActivityLimit(requestUrl.searchParams.get("limit")));
        sendJson(response, activity.ok ? 200 : activity.statusCode ?? 500, activity);
        return true;
    }

    if (requestUrl.pathname === "/api/fleet/alert-intents") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const alertIntents = await context.readFleetAlertIntents(resolveFleetAlertIntentLimit(requestUrl.searchParams.get("limit")));
        sendJson(response, alertIntents.ok ? 200 : alertIntents.statusCode ?? 500, alertIntents);
        return true;
    }

    if (requestUrl.pathname === "/api/fleet/projection") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const projection = await context.readFleetProjection();
        sendJson(response, projection.ok ? 200 : projection.statusCode ?? 500, projection);
        return true;
    }

    if (requestUrl.pathname === "/api/fleet/ship-combat-preview") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const preview = await context.readFleetShipCombatPreview();
        sendJson(response, preview.ok ? 200 : preview.statusCode ?? 500, preview);
        return true;
    }

    if (requestUrl.pathname === "/api/fleet/stream") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        context.handleFleetStream(request, response);
        return true;
    }

    return false;
}

function resolveFleetAlertIntentLimit(value, fallback = DEFAULT_ALERT_INTENT_LIMIT) {
    const parsed = Number.parseInt(value ?? `${fallback}`, 10);
    const safeValue = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(Math.max(safeValue, 1), MAX_ALERT_INTENT_LIMIT);
}
