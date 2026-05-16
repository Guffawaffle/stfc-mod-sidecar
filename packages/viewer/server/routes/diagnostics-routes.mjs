import { sendJson, sendText } from "../static-files.mjs";

export async function handleDiagnosticsRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname !== "/api/diagnostics/bundle") {
        return false;
    }

    if (request.method && request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    const bundle = await context.readDiagnosticsBundle();
    if (requestUrl.searchParams.get("format") === "markdown") {
        sendText(response, 200, context.buildDiagnosticsMarkdown(bundle), "text/markdown; charset=utf-8");
        return true;
    }

    sendJson(response, 200, bundle);
    return true;
}
