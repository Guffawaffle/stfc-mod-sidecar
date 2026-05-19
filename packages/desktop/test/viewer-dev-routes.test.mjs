import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { summarizeFleetBrokerError } from "../../core/src/broker/error-summary.ts";
import { buildUnavailableFleetBrokerSummary } from "../../viewer/server/fleet-broker-contract.mjs";
import { handleDevRoutes } from "../../viewer/server/routes/dev-routes.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverSource = readFileSync(path.resolve(__dirname, "../../viewer/server.mjs"), "utf8");

describe("viewer dev routes", () => {
    it("returns dev status with broker summary and no raw payload fields", async () => {
        const response = captureResponse();
        await handleDevRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/dev/status"),
            baseContext(),
        );

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body).toMatchObject({
            ok: true,
            eventStoreBackend: "sqlite",
            cloudTelemetry: { tokenConfigured: true },
            fleetBroker: {
                available: true,
                backend: "sqlite",
                cloudUploadEnabled: false,
                rawEventCount: 2,
                pendingOutboxCount: 1,
            },
        });
        expect(body.fleetBroker.payloadJson).toBeUndefined();
        expect(body.fleetBroker.authorization).toBeUndefined();
        expect(body.fleetBroker.cookie).toBeUndefined();
        expect(body.fleetBroker.syncToken).toBeUndefined();
        expect(response.body).not.toContain("local-sync-secret");
    });

    it("delegates ax package reads and keeps method gates", async () => {
        const axContext = baseContext();
        const axResponse = captureResponse();
        await handleDevRoutes(
            { method: "GET" },
            axResponse,
            new URL("http://127.0.0.1/api/dev/ax?limit=10"),
            axContext,
        );

        expect(axContext.readAxPackage).toHaveBeenCalledTimes(1);
        expect(axResponse.statusCode).toBe(200);
        expect(JSON.parse(axResponse.body)).toEqual({ ok: true, route: "ax" });

        const blockedResponse = captureResponse();
        await handleDevRoutes(
            { method: "POST" },
            blockedResponse,
            new URL("http://127.0.0.1/api/dev/status"),
            baseContext(),
        );
        expect(blockedResponse.statusCode).toBe(405);
    });

    it("stops dispatch after dev routes handle a request", () => {
        expect(serverSource).toContain("if (await handleDevRoutes(request, response, requestUrl,");
        expect(serverSource).toMatch(/if \(await handleDevRoutes\([\s\S]*?\)\) \{\s*return;\s*\}/u);
    });

    it("returns truncated degraded broker summaries without leaking sensitive error text", async () => {
        const response = captureResponse();
        await handleDevRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/dev/status"),
            baseContext({
                readFleetBrokerSummary: vi.fn(async () => buildUnavailableFleetBrokerSummary({
                    error: new Error(
                        "authorization: Bearer secret-token cookie=session-cookie syncToken=abc123 payload_json={\"secret\":true} request body={\"token\":\"abc\"} "
                        + "y".repeat(400),
                    ),
                    summarizeError: summarizeFleetBrokerError,
                    now: () => new Date("2026-05-18T12:34:56.000Z"),
                })),
            }),
        );

        const body = JSON.parse(response.body);
        expect(response.statusCode).toBe(200);
        expect(body.fleetBroker).toMatchObject({
            available: false,
            backend: "none",
            lastErrorAt: "2026-05-18T12:34:56.000Z",
        });
        expect(body.fleetBroker.lastError).not.toContain("secret-token");
        expect(body.fleetBroker.lastError).not.toContain("session-cookie");
        expect(body.fleetBroker.lastError).not.toContain("abc123");
        expect(body.fleetBroker.lastError).not.toContain("payload_json={");
        expect(body.fleetBroker.lastError.length).toBeLessThanOrEqual(240);
    });

    it("ignores unrelated routes", async () => {
        await expect(handleDevRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/health"),
            baseContext(),
        )).resolves.toBe(false);
    });
});

function baseContext(overrides = {}) {
    return {
        cloudTelemetryBridge: { status: () => ({ tokenConfigured: true, endpointConfigured: true }) },
        companionMode: "standard",
        communityModSettingsProfile: "netniv-basic",
        communityModVariantGate: { capabilityBits: { battleLog: 1, eventStore: 1 } },
        developerMode: false,
        feedPath: "C:/Games/STFC/game/community_patch_battle_feed.jsonl",
        getCommunityModCapabilities: () => ({ battleLog: true, eventStore: true }),
        getEventStoreBackend: () => "sqlite",
        readAxPackage: vi.fn(async () => ({ ok: true, route: "ax" })),
        readFleetBrokerSummary: vi.fn(async () => ({
            available: true,
            backend: "sqlite",
            cloudUploadEnabled: false,
            rawEventCount: 2,
            pendingOutboxCount: 1,
            projectionCount: 1,
            latestSequence: 2,
            lastObservedAt: "2026-05-18T12:00:00.000Z",
            lastProjectedAt: "2026-05-18T12:00:00.000Z",
            lastError: null,
            lastErrorAt: null,
        })),
        localSidecarSyncToken: "local-sync-secret",
        settingsPath: "C:/Games/STFC/game/community_patch_settings.toml",
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