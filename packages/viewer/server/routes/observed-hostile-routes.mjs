import { sendJson } from "../static-files.mjs";

export async function handleObservedHostileRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname !== "/api/observed-hostiles") {
        return false;
    }

    if (request.method && request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    const limitValue = Number.parseInt(requestUrl.searchParams.get("limit") ?? `${context.defaultLimit}`, 10);
    const catalog = await context.readObservedHostileCatalog(Number.isFinite(limitValue) ? limitValue : context.defaultLimit);
    sendJson(response, catalog.ok ? 200 : catalog.statusCode ?? 500, catalog);
    return true;
}
