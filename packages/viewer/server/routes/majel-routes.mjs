import { sendJson } from "../static-files.mjs";

export async function handleMajelRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/majel/ingest") {
        if (request.method === "POST") {
            await context.handleMajelIngest(request, response);
            return true;
        }

        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    if (requestUrl.pathname === "/api/majel/events") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? `${context.defaultLimit}`, 10);
        sendJson(response, 200, await context.readMajelSnapshot(Number.isFinite(limit) ? limit : context.defaultLimit));
        return true;
    }

    if (requestUrl.pathname === "/api/majel/stream") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        context.handleMajelStream(request, response);
        return true;
    }

    const detailMatch = /^\/api\/majel\/events\/([0-9]+)$/.exec(requestUrl.pathname);
    if (detailMatch) {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        const detail = await context.readMajelDetail(Number.parseInt(detailMatch[1], 10));
        sendJson(response, detail.ok ? 200 : detail.statusCode ?? 404, detail);
        return true;
    }

    return false;
}
