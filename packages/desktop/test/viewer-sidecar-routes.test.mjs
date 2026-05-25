import { describe, expect, it, vi } from "vitest";

import { handleSidecarRoutes } from "../../viewer/server/routes/sidecar-routes.mjs";

describe("viewer sidecar routes", () => {
    it("delegates sidecar ingest requests", async () => {
        const context = {
            handleSidecarIngest: vi.fn(async (_request, response) => {
                response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
                response.end(JSON.stringify({ ok: true, route: "sidecar" }));
            }),
        };
        const response = captureResponse();
        const request = { method: "POST" };

        await expect(handleSidecarRoutes(
            request,
            response,
            new URL("http://127.0.0.1/api/sidecar/ingest"),
            context,
        )).resolves.toBe(true);

        expect(context.handleSidecarIngest).toHaveBeenCalledWith(request, response);
        expect(response.statusCode).toBe(202);
        expect(JSON.parse(response.body)).toEqual({ ok: true, route: "sidecar" });
    });

    it("keeps method gates for sidecar ingest", async () => {
        const response = captureResponse();

        await expect(handleSidecarRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/sidecar/ingest"),
            { handleSidecarIngest: vi.fn() },
        )).resolves.toBe(true);

        expect(response.statusCode).toBe(405);
        expect(JSON.parse(response.body)).toEqual({ ok: false, error: "Method not allowed" });
    });

    it("ignores unrelated routes", async () => {
        await expect(handleSidecarRoutes(
            { method: "POST" },
            captureResponse(),
            new URL("http://127.0.0.1/api/events"),
            { handleSidecarIngest: vi.fn() },
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
