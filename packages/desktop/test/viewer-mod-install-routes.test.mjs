import { describe, expect, it, vi } from "vitest";

import { handleModInstallRoutes } from "../../viewer/server/routes/mod-install-routes.mjs";

describe("viewer mod install routes", () => {
    it("serves release catalog and install plan with normalized profiles", async () => {
        const context = baseContext({
            normalizeCommunityModReleaseProfile: vi.fn((profile) => `normalized:${profile}`),
        });

        const catalogResponse = captureResponse();
        await expect(handleModInstallRoutes(
            { method: "GET" },
            catalogResponse,
            new URL("http://127.0.0.1/api/mod/release-catalog?profile=waffle-basic"),
            context,
        )).resolves.toBe(true);
        expect(catalogResponse.statusCode).toBe(200);
        expect(JSON.parse(catalogResponse.body)).toEqual({
            ok: true,
            profile: "normalized:waffle-basic",
        });

        const planResponse = captureResponse();
        await expect(handleModInstallRoutes(
            { method: "GET" },
            planResponse,
            new URL("http://127.0.0.1/api/mod/install-plan"),
            context,
        )).resolves.toBe(true);
        expect(planResponse.statusCode).toBe(200);
        expect(JSON.parse(planResponse.body)).toMatchObject({
            ok: true,
            route: "install-plan",
            profile: "normalized:netniv-basic",
            install: { state: "installed" },
            catalog: { profile: "normalized:netniv-basic" },
        });
    });

    it("keeps install route method gates and ignores unrelated routes", async () => {
        const catalogResponse = captureResponse();
        await expect(handleModInstallRoutes(
            { method: "POST" },
            catalogResponse,
            new URL("http://127.0.0.1/api/mod/release-catalog"),
            baseContext(),
        )).resolves.toBe(true);
        expect(catalogResponse.statusCode).toBe(405);
        expect(JSON.parse(catalogResponse.body)).toEqual({ ok: false, error: "Method not allowed" });

        const verifyResponse = captureResponse();
        await expect(handleModInstallRoutes(
            { method: "GET" },
            verifyResponse,
            new URL("http://127.0.0.1/api/mod/verify-artifact"),
            baseContext(),
        )).resolves.toBe(true);
        expect(verifyResponse.statusCode).toBe(405);

        await expect(handleModInstallRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/mod/uninstall-plan"),
            baseContext(),
        )).resolves.toBe(false);
    });

    it("verifies, preflights, and stages artifacts through the configured cache", async () => {
        const context = baseContext({
            process: { env: { STFC_SIDECAR_CACHE_DIR: "D:/cache" } },
        });

        const verifyResponse = captureResponse();
        await handleModInstallRoutes(
            { method: "POST" },
            verifyResponse,
            new URL("http://127.0.0.1/api/mod/verify-artifact?profile=waffle-advanced"),
            context,
        );
        expect(verifyResponse.statusCode).toBe(200);
        expect(JSON.parse(verifyResponse.body)).toMatchObject({ status: "verified", cacheDir: "D:/cache" });

        const preflightResponse = captureResponse();
        await handleModInstallRoutes(
            { method: "POST" },
            preflightResponse,
            new URL("http://127.0.0.1/api/mod/install-preflight"),
            context,
        );
        expect(preflightResponse.statusCode).toBe(200);
        expect(JSON.parse(preflightResponse.body)).toMatchObject({
            status: "ready",
            artifactVerification: { status: "verified", cacheDir: "D:/cache" },
        });

        const stageResponse = captureResponse();
        await handleModInstallRoutes(
            { method: "POST" },
            stageResponse,
            new URL("http://127.0.0.1/api/mod/stage-artifact"),
            context,
        );
        expect(stageResponse.statusCode).toBe(200);
        expect(JSON.parse(stageResponse.body)).toMatchObject({ status: "staged", cacheDir: "D:/cache" });
    });

    it("keeps confirmation and execution safeguards", async () => {
        const invalidBodyResponse = captureResponse();
        await handleModInstallRoutes(
            { method: "POST" },
            invalidBodyResponse,
            new URL("http://127.0.0.1/api/mod/install-execution"),
            baseContext({ readJsonBody: vi.fn(async () => { throw new Error("bad json"); }) }),
        );
        expect(invalidBodyResponse.statusCode).toBe(400);
        expect(JSON.parse(invalidBodyResponse.body)).toMatchObject({
            ok: false,
            status: "invalid_request",
            error: "bad json",
        });

        const blockedContext = baseContext({
            buildCurrentCommunityModInstallConfirmation: vi.fn(async () => ({
                status: "artifact_not_verified",
                summary: { title: "Not ready" },
            })),
        });
        const blockedResponse = captureResponse();
        await handleModInstallRoutes(
            { method: "POST" },
            blockedResponse,
            new URL("http://127.0.0.1/api/mod/install-execution"),
            blockedContext,
        );
        expect(blockedContext.withCommunityModOperationLock).toHaveBeenCalledWith(
            blockedResponse,
            "install",
            expect.any(Function),
        );
        expect(blockedResponse.statusCode).toBe(200);
        expect(JSON.parse(blockedResponse.body)).toMatchObject({
            status: "blocked",
            confirmation: { status: "artifact_not_verified" },
            executionRequest: {
                status: "artifact_not_verified",
                warnings: ["Install execution is blocked by confirmation preflight."],
            },
        });

        const readyContext = baseContext();
        const readyResponse = captureResponse();
        await handleModInstallRoutes(
            { method: "POST" },
            readyResponse,
            new URL("http://127.0.0.1/api/mod/install-execution?profile=waffle-basic"),
            readyContext,
        );
        expect(readyResponse.statusCode).toBe(200);
        expect(JSON.parse(readyResponse.body)).toMatchObject({
            ok: true,
            status: "installed",
            gameProcess: { running: false, gameDirectory: "C:/Games/STFC/game" },
        });
        expect(readyContext.refreshCommunityModVariantGate).toHaveBeenCalledTimes(1);
    });
});

function baseContext(overrides = {}) {
    return {
        buildCommunityModInstallExecutionBlocked: vi.fn(({ confirmation, executionRequest }) => ({
            status: "blocked",
            confirmation,
            executionRequest,
        })),
        buildCommunityModInstallExecutionRequest: vi.fn(({ payload, confirmation, env }) => ({
            status: "ready",
            payload,
            confirmation,
            env,
        })),
        buildCommunityModInstallPlan: vi.fn(({ profile, install, catalog }) => ({
            ok: true,
            route: "install-plan",
            profile,
            install,
            catalog,
        })),
        buildCommunityModInstallPreflight: vi.fn(({ artifactVerification }) => artifactVerification
            ? { status: "ready", artifactVerification }
            : { status: "artifact_not_verified" }),
        buildCurrentCommunityModInstallConfirmation: vi.fn(async (profile) => ({
            status: "ready_for_confirmation",
            summary: { title: "Ready" },
            profile,
        })),
        communityModSettingsProfile: "netniv-basic",
        defaultArtifactCacheDir: "D:/default-cache",
        detectStfcGameProcess: vi.fn(async ({ gameDirectory }) => ({ running: false, gameDirectory })),
        executeCommunityModInstall: vi.fn(async ({ confirmation, gameProcess }) => ({
            ok: true,
            status: "installed",
            confirmation,
            gameProcess,
        })),
        fetchCommunityModReleaseCatalog: vi.fn(async ({ profile }) => ({ ok: true, profile })),
        gameDir: "C:/Games/STFC/game",
        normalizeCommunityModReleaseProfile: vi.fn((profile) => profile),
        process: { env: {} },
        readCommunityModInstallStatus: vi.fn(async () => ({ state: "installed" })),
        readJsonBody: vi.fn(async () => ({ destinationPathConfirmation: "C:/Games/STFC/game" })),
        refreshCommunityModVariantGate: vi.fn(async () => ({})),
        stageCommunityModArtifact: vi.fn(async ({ cacheDir, verification }) => ({
            status: "staged",
            cacheDir,
            verification,
        })),
        verifyCommunityModArtifact: vi.fn(async ({ cacheDir }) => ({ status: "verified", cacheDir })),
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
