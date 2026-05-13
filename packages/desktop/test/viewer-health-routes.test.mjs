import { describe, expect, it, vi } from "vitest";

import { handleHealthRoutes } from "../../viewer/server/routes/health-routes.mjs";

describe("viewer health routes", () => {
    it("returns the existing health payload fields", async () => {
        const response = captureResponse();
        const startedAt = new Date("2026-05-13T05:00:00.000Z");
        const handled = await handleHealthRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/health"),
            baseContext({
                startedAt,
                refreshCommunityModVariantGate: async () => ({
                    install: { state: "installed" },
                    variantGate: { capabilityBits: { battleLog: true } },
                }),
            }),
        );

        expect(handled).toBe(true);
        expect(response.statusCode).toBe(200);
        expect(response.headers).toMatchObject({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        });
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            pid: 1234,
            gameDir: "C:/Games/STFC/game",
            feedPath: "C:/Games/STFC/game/community_patch_battle_feed.jsonl",
            settingsPath: "C:/Games/STFC/game/community_patch_settings.toml",
            port: 43127,
            desktop: true,
            defaultLimit: 150,
            developerMode: false,
            companionMode: "standard",
            modProfile: "netniv-basic",
            settingsProfile: "netniv-basic",
            capabilities: { battleLog: true },
            capabilityBits: { battleLog: true },
            variantGate: { capabilityBits: { battleLog: true } },
            communityModInstall: { state: "installed" },
            release: { version: "0.1.0-test" },
            eventStoreBackend: "sqlite",
            storedEvents: 42,
            cloudTelemetry: { ok: true },
            startedAt: startedAt.toISOString(),
            shuttingDown: false,
            pollHintMs: 2000,
        });
    });

    it("keeps shutdown method, token, and auth gates", async () => {
        const getResponse = captureResponse();
        await handleHealthRoutes(
            { method: "GET" },
            getResponse,
            new URL("http://127.0.0.1/api/admin/shutdown"),
            baseContext({ shutdownToken: "token" }),
        );
        expect(getResponse.statusCode).toBe(405);

        const disabledResponse = captureResponse();
        await handleHealthRoutes(
            { method: "POST" },
            disabledResponse,
            new URL("http://127.0.0.1/api/admin/shutdown"),
            baseContext({ shutdownToken: "" }),
        );
        expect(disabledResponse.statusCode).toBe(403);

        const unauthorizedResponse = captureResponse();
        await handleHealthRoutes(
            { method: "POST" },
            unauthorizedResponse,
            new URL("http://127.0.0.1/api/admin/shutdown"),
            baseContext({
                isAuthorizedShutdownRequest: () => false,
                shutdownToken: "token",
            }),
        );
        expect(unauthorizedResponse.statusCode).toBe(401);
    });

    it("accepts authorized shutdown and schedules shutdown", async () => {
        const shutdownServer = vi.fn();
        const response = captureResponse();
        await handleHealthRoutes(
            { method: "POST" },
            response,
            new URL("http://127.0.0.1/api/admin/shutdown"),
            baseContext({
                isAuthorizedShutdownRequest: () => true,
                shutdownServer,
                shutdownToken: "token",
            }),
        );

        expect(response.statusCode).toBe(202);
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            pid: 1234,
            shuttingDown: true,
        });

        await new Promise((resolve) => setImmediate(resolve));
        expect(shutdownServer).toHaveBeenCalledWith("admin_request");
    });

    it("ignores unrelated routes", async () => {
        const response = captureResponse();
        await expect(handleHealthRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/other"),
            baseContext(),
        )).resolves.toBe(false);
    });
});

function baseContext(overrides = {}) {
    return {
        cloudTelemetryBridge: { status: () => ({ ok: true }) },
        companionMode: "standard",
        communityModSettingsProfile: "netniv-basic",
        countStoredEvents: async () => 42,
        defaultLimit: 150,
        developerMode: false,
        feedPath: "C:/Games/STFC/game/community_patch_battle_feed.jsonl",
        gameDir: "C:/Games/STFC/game",
        getCommunityModCapabilities: () => ({ battleLog: true }),
        getEventStoreBackend: () => "sqlite",
        isAuthorizedShutdownRequest: () => true,
        isShutdownRequested: () => false,
        pollHintMs: 2000,
        port: 43127,
        process: {
            env: { STFC_SIDECAR_DESKTOP: "1" },
            pid: 1234,
        },
        refreshCommunityModVariantGate: async () => ({
            install: null,
            variantGate: { capabilityBits: {} },
        }),
        releaseInfo: { version: "0.1.0-test" },
        settingsPath: "C:/Games/STFC/game/community_patch_settings.toml",
        shutdownServer: vi.fn(),
        shutdownToken: "token",
        startedAt: new Date("2026-05-13T05:00:00.000Z"),
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
