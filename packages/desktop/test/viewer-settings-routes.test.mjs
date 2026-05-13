import { describe, expect, it, vi } from "vitest";

import { handleSettingsRoutes } from "../../viewer/server/routes/settings-routes.mjs";

describe("viewer settings routes", () => {
    it("serves hotkey and notification settings snapshots", async () => {
        const hotkeysResponse = captureResponse();
        await expect(handleSettingsRoutes(
            { method: "GET" },
            hotkeysResponse,
            new URL("http://127.0.0.1/api/settings/hotkeys"),
            baseContext({ readHotkeySettingsSnapshot: async () => ({ ok: true, type: "hotkeys" }) }),
        )).resolves.toBe(true);
        expect(hotkeysResponse.statusCode).toBe(200);
        expect(JSON.parse(hotkeysResponse.body)).toEqual({ ok: true, type: "hotkeys" });

        const notificationsResponse = captureResponse();
        await expect(handleSettingsRoutes(
            { method: "GET" },
            notificationsResponse,
            new URL("http://127.0.0.1/api/settings/notifications"),
            baseContext({ readNotificationSettingsSnapshot: async () => ({ ok: true, type: "notifications" }) }),
        )).resolves.toBe(true);
        expect(notificationsResponse.statusCode).toBe(200);
        expect(JSON.parse(notificationsResponse.body)).toEqual({ ok: true, type: "notifications" });
    });

    it("delegates settings writes for existing PUT, PATCH, and POST methods", async () => {
        for (const method of ["PUT", "PATCH", "POST"]) {
            const handler = vi.fn(async (_request, response) => {
                response.writeHead(202, {});
                response.end("handled");
            });
            const response = captureResponse();
            await expect(handleSettingsRoutes(
                { method },
                response,
                new URL("http://127.0.0.1/api/settings/hotkeys"),
                baseContext({ handleHotkeySettingsUpdate: handler }),
            )).resolves.toBe(true);

            expect(handler).toHaveBeenCalledTimes(1);
            expect(response.statusCode).toBe(202);
            expect(response.body).toBe("handled");
        }
    });

    it("keeps diagnostics settings gated behind Developer Tools", async () => {
        const blockedResponse = captureResponse();
        await handleSettingsRoutes(
            { method: "GET" },
            blockedResponse,
            new URL("http://127.0.0.1/api/settings/diagnostics"),
            baseContext({ developerMode: false }),
        );
        expect(blockedResponse.statusCode).toBe(403);
        expect(JSON.parse(blockedResponse.body)).toEqual({
            ok: false,
            code: "developer_mode_required",
        });

        const allowedResponse = captureResponse();
        await handleSettingsRoutes(
            { method: "GET" },
            allowedResponse,
            new URL("http://127.0.0.1/api/settings/diagnostics"),
            baseContext({
                developerMode: true,
                readDiagnosticSettingsSnapshot: async () => ({ ok: true, type: "diagnostics" }),
            }),
        );
        expect(allowedResponse.statusCode).toBe(200);
        expect(JSON.parse(allowedResponse.body)).toEqual({ ok: true, type: "diagnostics" });
    });

    it("returns method not allowed for unsupported settings methods", async () => {
        const response = captureResponse();
        await expect(handleSettingsRoutes(
            { method: "DELETE" },
            response,
            new URL("http://127.0.0.1/api/settings/hotkeys"),
            baseContext(),
        )).resolves.toBe(true);

        expect(response.statusCode).toBe(405);
        expect(JSON.parse(response.body)).toEqual({ ok: false, error: "Method not allowed" });
    });

    it("ignores unrelated routes", async () => {
        await expect(handleSettingsRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/other"),
            baseContext(),
        )).resolves.toBe(false);
    });
});

function baseContext(overrides = {}) {
    return {
        developerMode: true,
        developerModeRequiredPayload: () => ({
            ok: false,
            code: "developer_mode_required",
        }),
        handleDiagnosticSettingsUpdate: vi.fn(),
        handleHotkeySettingsUpdate: vi.fn(),
        handleNotificationSettingsUpdate: vi.fn(),
        readDiagnosticSettingsSnapshot: async () => ({}),
        readHotkeySettingsSnapshot: async () => ({}),
        readNotificationSettingsSnapshot: async () => ({}),
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
