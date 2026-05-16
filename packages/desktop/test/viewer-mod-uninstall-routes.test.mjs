import { describe, expect, it, vi } from "vitest";

import { handleModUninstallRoutes } from "../../viewer/server/routes/mod-uninstall-routes.mjs";

describe("viewer mod uninstall routes", () => {
    it("serves uninstall plan and ignores install routes", async () => {
        const response = captureResponse();
        await expect(handleModUninstallRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/mod/uninstall-plan"),
            baseContext(),
        )).resolves.toBe(true);

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            route: "uninstall-plan",
            install: { state: "installed" },
        });

        await expect(handleModUninstallRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/mod/install-plan"),
            baseContext(),
        )).resolves.toBe(false);
    });

    it("keeps uninstall method gates and invalid body responses", async () => {
        const planResponse = captureResponse();
        await handleModUninstallRoutes(
            { method: "POST" },
            planResponse,
            new URL("http://127.0.0.1/api/mod/uninstall-plan"),
            baseContext(),
        );
        expect(planResponse.statusCode).toBe(405);
        expect(JSON.parse(planResponse.body)).toEqual({ ok: false, error: "Method not allowed" });

        const invalidConfirmationResponse = captureResponse();
        await handleModUninstallRoutes(
            { method: "POST" },
            invalidConfirmationResponse,
            new URL("http://127.0.0.1/api/mod/uninstall-confirmation"),
            baseContext({ readOptionalJsonBody: vi.fn(async () => { throw new Error("optional body failed"); }) }),
        );
        expect(invalidConfirmationResponse.statusCode).toBe(400);
        expect(JSON.parse(invalidConfirmationResponse.body)).toMatchObject({
            ok: false,
            status: "invalid_request",
            error: "optional body failed",
        });

        const invalidExecutionResponse = captureResponse();
        await handleModUninstallRoutes(
            { method: "POST" },
            invalidExecutionResponse,
            new URL("http://127.0.0.1/api/mod/uninstall-execution"),
            baseContext({ readJsonBody: vi.fn(async () => { throw new Error("bad json"); }) }),
        );
        expect(invalidExecutionResponse.statusCode).toBe(400);
        expect(JSON.parse(invalidExecutionResponse.body)).toMatchObject({
            ok: false,
            status: "invalid_request",
            error: "bad json",
        });
    });

    it("passes delete-settings acknowledgement through confirmation", async () => {
        const context = baseContext({
            readOptionalJsonBody: vi.fn(async () => ({ deleteSettingsAndLogs: true })),
        });
        const response = captureResponse();
        await handleModUninstallRoutes(
            { method: "POST" },
            response,
            new URL("http://127.0.0.1/api/mod/uninstall-confirmation"),
            context,
        );

        expect(context.buildCurrentCommunityModUninstallConfirmation).toHaveBeenCalledWith({
            deleteSettingsAndLogs: true,
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({ status: "ready_for_confirmation" });
    });

    it("keeps uninstall execution lock, block, and refresh behavior", async () => {
        const blockedContext = baseContext({
            buildCurrentCommunityModUninstallConfirmation: vi.fn(async () => ({
                status: "stfc_running",
                summary: { title: "Close STFC" },
            })),
        });
        const blockedResponse = captureResponse();
        await handleModUninstallRoutes(
            { method: "POST" },
            blockedResponse,
            new URL("http://127.0.0.1/api/mod/uninstall-execution"),
            blockedContext,
        );
        expect(blockedContext.withCommunityModOperationLock).toHaveBeenCalledWith(
            blockedResponse,
            "uninstall",
            expect.any(Function),
        );
        expect(blockedResponse.statusCode).toBe(200);
        expect(JSON.parse(blockedResponse.body)).toMatchObject({
            status: "blocked",
            confirmation: { status: "stfc_running" },
            executionRequest: {
                status: "stfc_running",
                warnings: ["Uninstall execution is blocked by confirmation preflight."],
            },
        });

        const readyContext = baseContext({
            readJsonBody: vi.fn(async () => ({ deleteSettingsAndLogs: true })),
        });
        const readyResponse = captureResponse();
        await handleModUninstallRoutes(
            { method: "POST" },
            readyResponse,
            new URL("http://127.0.0.1/api/mod/uninstall-execution"),
            readyContext,
        );
        expect(readyContext.buildCurrentCommunityModUninstallConfirmation).toHaveBeenCalledWith({
            deleteSettingsAndLogs: true,
        });
        expect(readyResponse.statusCode).toBe(200);
        expect(JSON.parse(readyResponse.body)).toMatchObject({
            ok: true,
            status: "uninstalled",
            gameProcess: { running: false, gameDirectory: "C:/Games/STFC/game" },
        });
        expect(readyContext.refreshCommunityModVariantGate).toHaveBeenCalledTimes(1);
    });
});

function baseContext(overrides = {}) {
    return {
        buildCommunityModUninstallExecutionBlocked: vi.fn(({ confirmation, executionRequest }) => ({
            status: "blocked",
            confirmation,
            executionRequest,
        })),
        buildCommunityModUninstallExecutionRequest: vi.fn(({ payload, confirmation, env }) => ({
            status: "ready",
            payload,
            confirmation,
            env,
        })),
        buildCommunityModUninstallPlan: vi.fn(({ install }) => ({
            ok: true,
            route: "uninstall-plan",
            install,
        })),
        buildCurrentCommunityModUninstallConfirmation: vi.fn(async (options) => ({
            status: "ready_for_confirmation",
            summary: { title: "Ready" },
            options,
        })),
        detectStfcGameProcess: vi.fn(async ({ gameDirectory }) => ({ running: false, gameDirectory })),
        executeCommunityModUninstall: vi.fn(async ({ confirmation, gameProcess }) => ({
            ok: true,
            status: "uninstalled",
            confirmation,
            gameProcess,
        })),
        gameDir: "C:/Games/STFC/game",
        process: { env: {} },
        readCommunityModInstallStatus: vi.fn(async () => ({ state: "installed" })),
        readJsonBody: vi.fn(async () => ({ deleteSettingsAndLogs: false })),
        readOptionalJsonBody: vi.fn(async () => ({})),
        refreshCommunityModVariantGate: vi.fn(async () => ({})),
        withCommunityModOperationLock: vi.fn(async (_response, _operation, handler) => handler()),
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
