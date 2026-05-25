import { sendJson } from "../static-files.mjs";

export async function handleSidecarRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname !== "/api/sidecar/ingest") {
        return false;
    }

    if (request.method === "POST") {
        await context.handleSidecarIngest(request, response);
        return true;
    }

    sendJson(response, 405, { ok: false, error: "Method not allowed" });
    return true;
}
