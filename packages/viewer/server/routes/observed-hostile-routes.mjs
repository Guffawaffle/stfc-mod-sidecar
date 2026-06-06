import { sendJson } from "../static-files.mjs";

export async function handleObservedHostileRoutes(request, response, requestUrl, context) {
    if (!isObservedHostileRoute(requestUrl.pathname)) {
        return false;
    }

    if (request.method && request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return true;
    }

    if (requestUrl.pathname === "/api/observed-hostiles/catalog-entries") {
        const catalog = await context.readObservedHostileCatalogEntries(readPagingOptions(requestUrl, context.defaultLimit));
        sendJson(response, catalog.ok ? 200 : catalog.statusCode ?? 500, catalog);
        return true;
    }

    if (requestUrl.pathname === "/api/observed-hostiles/observations") {
        const observations = await context.readObservedHostileObservations(readPagingOptions(requestUrl, context.defaultLimit));
        sendJson(response, observations.ok ? 200 : observations.statusCode ?? 500, observations);
        return true;
    }

    const catalog = await context.readObservedHostileCatalog(readLimit(requestUrl, context.defaultLimit));
    sendJson(response, catalog.ok ? 200 : catalog.statusCode ?? 500, catalog);
    return true;
}

function isObservedHostileRoute(pathname) {
    return pathname === "/api/observed-hostiles"
        || pathname === "/api/observed-hostiles/catalog-entries"
        || pathname === "/api/observed-hostiles/observations";
}

function readPagingOptions(requestUrl, defaultLimit) {
    return {
        limit: readLimit(requestUrl, defaultLimit),
        cursor: requestUrl.searchParams.get("cursor") ?? "",
        sort: requestUrl.searchParams.get("sort") ?? "latest_seen_desc",
        status: requestUrl.searchParams.get("status") ?? "",
        reference: requestUrl.searchParams.get("reference") ?? "",
        systemId: requestUrl.searchParams.get("systemId") ?? "",
        q: requestUrl.searchParams.get("q") ?? "",
    };
}

function readLimit(requestUrl, defaultLimit) {
    const limitValue = Number.parseInt(requestUrl.searchParams.get("limit") ?? `${defaultLimit}`, 10);
    return Number.isFinite(limitValue) ? limitValue : defaultLimit;
}
