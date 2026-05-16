import { describe, expect, it, vi } from "vitest";

import { handleDiagnosticsRoutes } from "../../viewer/server/routes/diagnostics-routes.mjs";

describe("viewer diagnostics routes", () => {
    it("serves diagnostics bundle JSON", async () => {
        const response = captureResponse();
        await expect(handleDiagnosticsRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/diagnostics/bundle"),
            baseContext({ readDiagnosticsBundle: vi.fn(async () => ({ ok: true, source: "test" })) }),
        )).resolves.toBe(true);

        expect(response.statusCode).toBe(200);
        expect(response.headers).toMatchObject({ "content-type": "application/json; charset=utf-8" });
        expect(JSON.parse(response.body)).toEqual({ ok: true, source: "test" });
    });

    it("serves diagnostics bundle markdown format", async () => {
        const context = baseContext({
            buildDiagnosticsMarkdown: vi.fn((bundle) => `# Diagnostics\n${bundle.source}`),
            readDiagnosticsBundle: vi.fn(async () => ({ ok: true, source: "markdown-test" })),
        });
        const response = captureResponse();
        await expect(handleDiagnosticsRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/diagnostics/bundle?format=markdown"),
            context,
        )).resolves.toBe(true);

        expect(context.buildDiagnosticsMarkdown).toHaveBeenCalledWith({ ok: true, source: "markdown-test" });
        expect(response.statusCode).toBe(200);
        expect(response.headers).toMatchObject({ "content-type": "text/markdown; charset=utf-8" });
        expect(response.body).toBe("# Diagnostics\nmarkdown-test");
    });

    it("keeps method gate and ignores unrelated routes", async () => {
        const blockedResponse = captureResponse();
        await expect(handleDiagnosticsRoutes(
            { method: "POST" },
            blockedResponse,
            new URL("http://127.0.0.1/api/diagnostics/bundle"),
            baseContext(),
        )).resolves.toBe(true);
        expect(blockedResponse.statusCode).toBe(405);
        expect(JSON.parse(blockedResponse.body)).toEqual({ ok: false, error: "Method not allowed" });

        await expect(handleDiagnosticsRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/other"),
            baseContext(),
        )).resolves.toBe(false);
    });
});

function baseContext(overrides = {}) {
    return {
        buildDiagnosticsMarkdown: vi.fn(() => "# Diagnostics"),
        readDiagnosticsBundle: vi.fn(async () => ({})),
        ...overrides,
    };
}

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
