import { sendJson } from "../static-files.mjs";

export async function handleFleetRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/fleet/sync") {
        if (request.method === "POST") {
            await context.handleFleetSyncIngest(request, response);
            return true;
        }

        sendJson(response, 405, { ok: false, error: "Method not allowed" });
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
