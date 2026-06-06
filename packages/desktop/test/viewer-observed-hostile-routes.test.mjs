import { describe, expect, it, vi } from "vitest";

import { handleObservedHostileRoutes } from "../../viewer/server/routes/observed-hostile-routes.mjs";

describe("viewer observed hostile routes", () => {
    it("delegates observed hostile catalog reads", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileCatalog: vi.fn(async (limit) => ({
                ok: true,
                detail: "observed-hostile-index",
                limit,
                entries: [{ key: "hull:3066099110", title: "Armada Carrier" }],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles?limit=25"),
            context,
        )).resolves.toBe(true);

        expect(context.readObservedHostileCatalog).toHaveBeenCalledWith(25);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            detail: "observed-hostile-index",
            entries: [{ key: "hull:3066099110", title: "Armada Carrier" }],
        });
    });

    it("delegates paged catalog entry reads with filters", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileCatalogEntries: vi.fn(async (options) => ({
                ok: true,
                detail: "observed-hostile-catalog-entries",
                options,
                items: [],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles/catalog-entries?limit=25&cursor=abc&status=ambiguous&reference=unknown&systemId=818257505&q=rom"),
            context,
        )).resolves.toBe(true);

        expect(context.readObservedHostileCatalogEntries).toHaveBeenCalledWith({
            limit: 25,
            cursor: "abc",
            sort: "latest_seen_desc",
            status: "ambiguous",
            reference: "unknown",
            systemId: "818257505",
            q: "rom",
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            detail: "observed-hostile-catalog-entries",
        });
    });

    it("delegates system observation reads", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileObservations: vi.fn(async (options) => ({
                ok: true,
                detail: "observed-hostile-observations",
                options,
                items: [],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles/observations?limit=10&q=system"),
            context,
        )).resolves.toBe(true);

        expect(context.readObservedHostileObservations).toHaveBeenCalledWith({
            limit: 10,
            cursor: "",
            sort: "latest_seen_desc",
            status: "",
            reference: "",
            systemId: "",
            q: "system",
        });
        expect(response.statusCode).toBe(200);
    });

    it("keeps method gates for observed hostile routes", async () => {
        const response = captureResponse();
        await handleObservedHostileRoutes(
            { method: "POST" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles"),
            { defaultLimit: 150, readObservedHostileCatalog: vi.fn() },
        );

        expect(response.statusCode).toBe(405);
        expect(JSON.parse(response.body)).toEqual({ ok: false, error: "Method not allowed" });
    });

    it("ignores unrelated routes", async () => {
        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/events"),
            { defaultLimit: 150, readObservedHostileCatalog: vi.fn() },
        )).resolves.toBe(false);
    });
});

function captureResponse() {
    return {
        body: "",
        headers: null,
        statusCode: 0,
        writeHead(statusCode, headers) {
            this.statusCode = statusCode;
            this.headers = headers;
        },
        end(body) {
            this.body = body;
        },
    };
}
