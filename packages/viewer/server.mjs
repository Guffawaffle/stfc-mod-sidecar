import { createServer } from "node:http";
import { existsSync, readFileSync, watch } from "node:fs";
import { copyFile, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    companionModeFromDeveloperMode,
    developerModeRequiredPayload,
    isDeveloperOnlyApiPath,
    isDeveloperOnlyPublicPath,
    parseDeveloperModeFlag,
} from "./runtime-mode.mjs";
import {
    isAuthorizedModRequest as isModRequestAuthorized,
    isAuthorizedSettingsRequest as isSettingsRequestAuthorized,
    isAuthorizedShutdownRequest as isShutdownRequestAuthorized,
    isAuthorizedSyncRequest as isSyncRequestAuthorized,
    resolveModToken,
    resolveSettingsToken,
    resolveSyncToken,
} from "./local-auth.mjs";
import { buildReleaseInfo } from "./release-info.mjs";
import { fetchReleaseUpdateCheck } from "./release-update.mjs";
import { buildDiagnosticsBundle, buildDiagnosticsMarkdown } from "./diagnostics-bundle.mjs";
import { buildCapabilityUnavailablePage } from "./public-page-responses.mjs";
import { buildCommunityModVariantGateContext } from "./community-mod-variant-gates.mjs";
import { detectCommunityModInstall } from "./community-mod-install.mjs";
import { verifyCommunityModArtifact } from "./community-mod-artifact-verification.mjs";
import { stageCommunityModArtifact } from "./community-mod-artifact-staging.mjs";
import { buildCommunityModInstallConfirmation } from "./community-mod-install-confirmation.mjs";
import {
    buildCommunityModInstallExecutionBlocked,
    buildCommunityModInstallExecutionRequest,
    executeCommunityModInstall,
} from "./community-mod-install-execution.mjs";
import {
    buildCommunityModInstallPreflight,
    detectStfcGameProcess,
} from "./community-mod-install-preflight.mjs";
import {
    fetchCommunityModReleaseCatalog,
    normalizeCommunityModReleaseProfile,
} from "./community-mod-release-catalog.mjs";
import { buildCommunityModInstallPlan } from "./community-mod-install-plan.mjs";
import { buildCommunityModUninstallPlan } from "./community-mod-uninstall-plan.mjs";
import {
    buildCommunityModUninstallConfirmation,
    buildCommunityModUninstallExecutionBlocked,
    buildCommunityModUninstallExecutionRequest,
    executeCommunityModUninstall,
} from "./community-mod-uninstall-execution.mjs";

const DEFAULT_GAME_DIR = "C:\\Games\\Star Trek Fleet Command\\default\\game";
const DEFAULT_FEED_FILE = "community_patch_battle_feed.jsonl";
const DEFAULT_FEED_PATH = path.join(DEFAULT_GAME_DIR, DEFAULT_FEED_FILE);
const DEFAULT_SETTINGS_FILE = "community_patch_settings.toml";
const DEFAULT_PORT = 43127;
const DEFAULT_LIMIT = 150;
const DETAIL_CACHE_LIMIT = 128;
const DEFAULT_STORE_PATH = "./.sidecar/sidecar-events.sqlite";
const SETTINGS_SAVE_MODE_LOCAL_TRUSTED = "local_trusted";
const SETTINGS_SAVE_MODE_REMOTE_PROTECTED = "remote_protected";
const MAX_EVENT_INGEST_BYTES = 5 * 1024 * 1024;
const POLL_HINT_MS = 2000;
const STREAM_KEEPALIVE_MS = 30000;
const SHUTDOWN_GRACE_MS = 5000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const publicDir = path.join(__dirname, "public");
const DEFAULT_ARTIFACT_CACHE_DIR = path.join(repoRoot, ".sidecar", "mod-artifacts");

const { gameDir, feedPath, settingsPath, port, defaultLimit, developerMode } = parseArgs(process.argv.slice(2));
const companionMode = companionModeFromDeveloperMode(developerMode);
const startedAt = new Date();
const shutdownToken = process.env.STFC_SIDECAR_SHUTDOWN_TOKEN ?? "";
const syncToken = resolveSyncToken(process.env);
const settingsToken = resolveSettingsToken(process.env);
const modToken = resolveModToken(process.env);
const settingsSaveMode = parseSettingsSaveMode(process.env.STFC_SIDECAR_SETTINGS_SAVE_MODE);
const releaseInfo = buildReleaseInfo({
    version: process.env.STFC_SIDECAR_APP_VERSION ?? readPackageVersion(),
    channel: process.env.STFC_SIDECAR_RELEASE_CHANNEL,
    updateMode: process.env.STFC_SIDECAR_UPDATE_MODE,
    signaturePolicy: process.env.STFC_SIDECAR_SIGNATURE_POLICY,
    packaged: process.env.STFC_SIDECAR_DESKTOP === "1",
});
let feedIndex = createEmptyFeedIndex();
let feedWatcher = null;
let feedWatcherPath = "";
let feedWatcherDebounce = null;
const eventStreamClients = new Set();
const communityModOperationLocks = new Map();

let shutdownRequested = false;
let exitTimer;

let createSqlSidecarEventStore;
let applyCommunityModHotkeySettingsPatch;
let applyCommunityModNotificationSettingsPatch;
let buildCommunityModHotkeySettingsSnapshot;
let buildCommunityModNotificationSettingsSnapshot;
let normalizeCommunityModSettingsProfile;
let isSidecarEvent;
let parseEventJsonLine;
try {
    ({
        applyCommunityModHotkeySettingsPatch,
        applyCommunityModNotificationSettingsPatch,
        buildCommunityModHotkeySettingsSnapshot,
        buildCommunityModNotificationSettingsSnapshot,
        createSqlSidecarEventStore,
        isSidecarEvent,
        normalizeCommunityModSettingsProfile,
        parseEventJsonLine,
    } = await import(new URL("../core/dist/index.js", import.meta.url)));
} catch (error) {
    console.error("Unable to load @stfc-mod-sidecar/core. Run `npm run build --workspace @stfc-mod-sidecar/core` first.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

const communityModSettingsProfile = normalizeCommunityModSettingsProfile(process.env.STFC_SIDECAR_MOD_PROFILE);
let communityModInstallStatus = await readCommunityModInstallStatus();
let communityModVariantGate = buildCommunityModVariantGateContext({
    install: communityModInstallStatus,
    selectedProfile: communityModSettingsProfile,
});
let communityModCapabilities = communityModVariantGate.capabilities;
let eventStore = await createConfiguredEventStore();
let eventStoreRevision = 0;

const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);

    if (isDeveloperOnlyApiPath(requestUrl.pathname) && !developerMode) {
        return sendJson(response, 403, developerModeRequiredPayload());
    }

    if (isBattleLogApiPath(requestUrl.pathname) && !communityModCapabilities.battleLog) {
        return sendJson(response, 403, capabilityUnavailablePayload("battleLog"));
    }

    if (isPrivilegedModApiPath(requestUrl.pathname) && !isAuthorizedModRequest(request)) {
        return sendJson(response, 401, {
            ok: false,
            status: "unauthorized",
            error: "Unauthorized Community Mod operation request",
        });
    }

    if (isGithubNetworkApiPath(requestUrl.pathname) && !hasGithubNetworkConsent(request)) {
        return sendJson(response, 428, {
            ok: false,
            status: "network_consent_required",
            error: "Explicit GitHub network consent is required for this request.",
            network: { host: "github.com", consentHeader: "x-sidecar-network-consent" },
        });
    }

    if (requestUrl.pathname === "/api/events") {
        if (request.method === "POST") {
            return handleEventIngest(request, response);
        }

        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        const limitValue = Number.parseInt(requestUrl.searchParams.get("limit") ?? `${defaultLimit}`, 10);
        const detailMode = requestUrl.searchParams.get("detail") ?? "full";
        const snapshot = await readEventsSnapshot(Number.isFinite(limitValue) ? limitValue : defaultLimit, {
            includeDetails: detailMode !== "summary",
        });
        return sendJson(response, 200, snapshot);
    }

    if (requestUrl.pathname === "/api/events/stream") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        return handleEventStream(request, response);
    }

    if (requestUrl.pathname === "/api/settings/hotkeys") {
        if (request.method === "GET") {
            return sendJson(response, 200, await readHotkeySettingsSnapshot());
        }

        if (request.method === "PUT" || request.method === "PATCH" || request.method === "POST") {
            return handleHotkeySettingsUpdate(request, response);
        }

        return sendJson(response, 405, { ok: false, error: "Method not allowed" });
    }

    if (requestUrl.pathname === "/api/settings/notifications") {
        if (request.method === "GET") {
            return sendJson(response, 200, await readNotificationSettingsSnapshot());
        }

        if (request.method === "PUT" || request.method === "PATCH" || request.method === "POST") {
            return handleNotificationSettingsUpdate(request, response);
        }

        return sendJson(response, 405, { ok: false, error: "Method not allowed" });
    }

    if (requestUrl.pathname === "/api/diagnostics/bundle") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        const bundle = await readDiagnosticsBundle();
        if (requestUrl.searchParams.get("format") === "markdown") {
            return sendText(response, 200, buildDiagnosticsMarkdown(bundle), "text/markdown; charset=utf-8");
        }

        return sendJson(response, 200, bundle);
    }

    if (requestUrl.pathname === "/api/release/check") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            return sendJson(response, 200, await fetchReleaseUpdateCheck({
                currentRelease: releaseInfo,
                repository: process.env.STFC_SIDECAR_RELEASE_REPOSITORY,
            }));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
                current: releaseInfo,
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/release-catalog") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            return sendJson(response, 200, await fetchCommunityModReleaseCatalog({
                profile: normalizeCommunityModReleaseProfile(
                    requestUrl.searchParams.get("profile") ?? communityModSettingsProfile,
                ),
            }));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/install-plan") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            const profile = normalizeCommunityModReleaseProfile(
                requestUrl.searchParams.get("profile") ?? communityModSettingsProfile,
            );
            const [install, catalog] = await Promise.all([
                readCommunityModInstallStatus(),
                fetchCommunityModReleaseCatalog({ profile }),
            ]);
            return sendJson(response, 200, buildCommunityModInstallPlan({ profile, install, catalog }));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/uninstall-plan") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            return sendJson(response, 200, buildCommunityModUninstallPlan({
                install: await readCommunityModInstallStatus(),
            }));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/uninstall-confirmation") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        let payload;
        try {
            payload = await readOptionalJsonBody(request);
        } catch (error) {
            return sendJson(response, 400, {
                ok: false,
                status: "invalid_request",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }

        try {
            return sendJson(response, 200, await buildCurrentCommunityModUninstallConfirmation({
                deleteSettingsAndLogs: payload.deleteSettingsAndLogs === true,
            }));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/uninstall-execution") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        let payload;
        try {
            payload = await readJsonBody(request);
        } catch (error) {
            return sendJson(response, 400, {
                ok: false,
                status: "invalid_request",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }

        try {
            return await withCommunityModOperationLock(response, "uninstall", async () => {
                const confirmation = await buildCurrentCommunityModUninstallConfirmation({
                    deleteSettingsAndLogs: payload.deleteSettingsAndLogs === true,
                });
                if (confirmation.status !== "ready_for_confirmation") {
                    return sendJson(response, 200, buildCommunityModUninstallExecutionBlocked({
                        confirmation,
                        executionRequest: {
                            ok: true,
                            status: confirmation.status,
                            summary: confirmation.summary,
                            warnings: ["Uninstall execution is blocked by confirmation preflight."],
                        },
                    }));
                }

                const executionRequest = buildCommunityModUninstallExecutionRequest({
                    payload,
                    confirmation,
                    env: process.env,
                });
                if (executionRequest.status !== "ready") {
                    return sendJson(response, 200, buildCommunityModUninstallExecutionBlocked({ confirmation, executionRequest }));
                }

                const result = await executeCommunityModUninstall({
                    confirmation,
                    gameProcess: await detectStfcGameProcess({ gameDirectory: gameDir }),
                    enableExecution: true,
                });
                await refreshCommunityModVariantGate();
                return sendJson(response, 200, result);
            });
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/verify-artifact") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            const profile = normalizeCommunityModReleaseProfile(
                requestUrl.searchParams.get("profile") ?? communityModSettingsProfile,
            );
            const catalog = await fetchCommunityModReleaseCatalog({ profile });
            return sendJson(response, 200, await verifyCommunityModArtifact({
                catalog,
                cacheDir: process.env.STFC_SIDECAR_CACHE_DIR || DEFAULT_ARTIFACT_CACHE_DIR,
            }));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/install-preflight") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            const profile = normalizeCommunityModReleaseProfile(
                requestUrl.searchParams.get("profile") ?? communityModSettingsProfile,
            );
            const [install, catalog] = await Promise.all([
                readCommunityModInstallStatus(),
                fetchCommunityModReleaseCatalog({ profile }),
            ]);
            const installPlan = buildCommunityModInstallPlan({ profile, install, catalog });
            const gameProcess = await detectStfcGameProcess({ gameDirectory: gameDir });
            let preflight = buildCommunityModInstallPreflight({ installPlan, gameProcess });
            if (preflight.status === "artifact_not_verified") {
                const artifactVerification = await verifyCommunityModArtifact({
                    catalog,
                    cacheDir: process.env.STFC_SIDECAR_CACHE_DIR || DEFAULT_ARTIFACT_CACHE_DIR,
                });
                preflight = buildCommunityModInstallPreflight({ installPlan, artifactVerification, gameProcess });
            }

            return sendJson(response, 200, preflight);
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/stage-artifact") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            const profile = normalizeCommunityModReleaseProfile(
                requestUrl.searchParams.get("profile") ?? communityModSettingsProfile,
            );
            const catalog = await fetchCommunityModReleaseCatalog({ profile });
            const cacheDir = process.env.STFC_SIDECAR_CACHE_DIR || DEFAULT_ARTIFACT_CACHE_DIR;
            const verification = await verifyCommunityModArtifact({ catalog, cacheDir });
            return sendJson(response, 200, await stageCommunityModArtifact({ catalog, verification, cacheDir }));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/install-confirmation") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        try {
            const profile = normalizeCommunityModReleaseProfile(
                requestUrl.searchParams.get("profile") ?? communityModSettingsProfile,
            );
            return sendJson(response, 200, await buildCurrentCommunityModInstallConfirmation(profile));
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    if (requestUrl.pathname === "/api/mod/install-execution") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        let payload;
        try {
            payload = await readJsonBody(request);
        } catch (error) {
            return sendJson(response, 400, {
                ok: false,
                status: "invalid_request",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }

        try {
            return await withCommunityModOperationLock(response, "install", async () => {
                const profile = normalizeCommunityModReleaseProfile(
                    requestUrl.searchParams.get("profile") ?? communityModSettingsProfile,
                );
                const confirmation = await buildCurrentCommunityModInstallConfirmation(profile);
                if (confirmation.status !== "ready_for_confirmation") {
                    return sendJson(response, 200, buildCommunityModInstallExecutionBlocked({
                        confirmation,
                        executionRequest: {
                            ok: true,
                            status: confirmation.status,
                            summary: confirmation.summary,
                            warnings: ["Install execution is blocked by confirmation preflight."],
                        },
                    }));
                }

                const executionRequest = buildCommunityModInstallExecutionRequest({
                    payload,
                    confirmation,
                    env: process.env,
                });
                if (executionRequest.status !== "ready") {
                    return sendJson(response, 200, buildCommunityModInstallExecutionBlocked({ confirmation, executionRequest }));
                }

                const result = await executeCommunityModInstall({
                    confirmation,
                    gameProcess: await detectStfcGameProcess({ gameDirectory: gameDir }),
                    enableExecution: true,
                });
                await refreshCommunityModVariantGate();
                return sendJson(response, 200, result);
            });
        } catch (error) {
            return sendJson(response, 502, {
                ok: false,
                status: "error",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
        }
    }

    const eventLineMatch = /^\/api\/events\/([0-9]+)$/.exec(requestUrl.pathname);
    if (eventLineMatch) {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        const lineNumber = Number.parseInt(eventLineMatch[1], 10);
        const detail = await readEventDetail(lineNumber);
        return sendJson(response, detail.ok ? 200 : detail.statusCode ?? 404, detail);
    }

    if (requestUrl.pathname === "/api/health") {
        const { install: communityModInstall, variantGate } = await refreshCommunityModVariantGate();
        const storedEvents = await countStoredEvents();
        return sendJson(response, 200, {
            ok: true,
            pid: process.pid,
            gameDir,
            feedPath,
            settingsPath,
            port,
            defaultLimit,
            developerMode,
            companionMode,
            modProfile: communityModSettingsProfile,
            settingsProfile: communityModSettingsProfile,
            capabilities: communityModCapabilities,
            capabilityBits: variantGate.capabilityBits,
            variantGate,
            communityModInstall,
            release: releaseInfo,
            eventStoreBackend: eventStore?.backend ?? "none",
            storedEvents,
            startedAt: startedAt.toISOString(),
            uptimeMs: Date.now() - startedAt.getTime(),
            shuttingDown: shutdownRequested,
            pollHintMs: POLL_HINT_MS,
            generatedAt: new Date().toISOString(),
        });
    }

    if (requestUrl.pathname === "/api/dev/status") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        return sendJson(response, 200, {
            ok: true,
            developerMode,
            companionMode,
            modProfile: communityModSettingsProfile,
            settingsProfile: communityModSettingsProfile,
            capabilities: communityModCapabilities,
            capabilityBits: communityModVariantGate.capabilityBits,
            variantGate: communityModVariantGate,
            feedPath,
            settingsPath,
            eventStoreBackend: eventStore?.backend ?? "none",
            generatedAt: new Date().toISOString(),
        });
    }

    if (requestUrl.pathname === "/api/admin/shutdown") {
        if (request.method !== "POST") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        if (!shutdownToken) {
            return sendJson(response, 403, { ok: false, error: "Shutdown control is disabled for this process" });
        }

        if (!isAuthorizedShutdownRequest(request)) {
            return sendJson(response, 401, { ok: false, error: "Unauthorized shutdown request" });
        }

        sendJson(response, 202, {
            ok: true,
            pid: process.pid,
            shuttingDown: true,
        });
        setImmediate(() => {
            void shutdownServer("admin_request");
        });
        return;
    }

    if (isDeveloperOnlyPublicPath(requestUrl.pathname) && !developerMode) {
        return sendJson(response, 403, developerModeRequiredPayload());
    }

    if (isBattleLogPublicPath(requestUrl.pathname) && !communityModCapabilities.battleLog) {
        const reasons = communityModVariantGate.capabilityReasons.battleLog ?? [];
        return sendText(response, 403, buildCapabilityUnavailablePage({
            title: "Battle Log unavailable",
            heading: "Battle Log Unavailable",
            message: "Battle Log surfaces are currently blocked by the active Community Mod variant gate.",
            details: variantGateCapabilityDetails("battleLog", reasons),
            primaryHref: "/",
            primaryLabel: "Open Home",
            secondaryHref: "/settings/",
            secondaryLabel: "Open Settings",
        }), "text/html; charset=utf-8");
    }

    const publicAsset = await resolvePublicAsset(requestUrl.pathname);
    if (publicAsset) {
        return sendFile(response, publicAsset.filePath, publicAsset.contentType);
    }

    return sendJson(response, 404, { ok: false, error: "Not found" });
});

server.on("error", (error) => {
    console.error(`[sidecar-viewer] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
    console.log(`[sidecar-viewer] pid ${process.pid}`);
    console.log(`[sidecar-viewer] listening on http://127.0.0.1:${port}`);
    if (communityModCapabilities.battleLog) {
        console.log(`[sidecar-viewer] feed path: ${feedPath}`);
        ensureFeedWatcher();
    } else {
        console.log(`[sidecar-viewer] battle log surfaces disabled for profile ${communityModSettingsProfile}`);
    }
});

process.on("SIGINT", () => {
    void shutdownServer("SIGINT");
});

process.on("SIGTERM", () => {
    void shutdownServer("SIGTERM");
});

async function createConfiguredEventStore() {
    if (!communityModCapabilities.eventStore) {
        return null;
    }

    const backend = (process.env.STFC_SIDECAR_STORE_BACKEND ?? "sqlite").trim().toLowerCase();
    if (backend === "none") {
        return null;
    }

    if (backend === "sqlite") {
        return createSqlSidecarEventStore({
            backend: "sqlite",
            connection: resolveStoreConnection(process.env.STFC_SIDECAR_STORE_CONNECTION ?? DEFAULT_STORE_PATH),
        });
    }

    if (backend === "postgres") {
        const connection = process.env.STFC_SIDECAR_STORE_CONNECTION ?? process.env.DATABASE_URL ?? "";
        if (!connection) {
            throw new Error("STFC_SIDECAR_STORE_CONNECTION or DATABASE_URL is required when STFC_SIDECAR_STORE_BACKEND=postgres");
        }

        return createSqlSidecarEventStore({
            backend: "postgres",
            connection,
        });
    }

    throw new Error(`Unsupported STFC_SIDECAR_STORE_BACKEND: ${backend}`);
}

function isBattleLogApiPath(pathname) {
    return pathname === "/api/events" || pathname === "/api/events/stream" || /^\/api\/events\/[0-9]+$/.test(pathname);
}

function isBattleLogPublicPath(pathname) {
    return pathname === "/battle-log" || pathname.startsWith("/battle-log/");
}

function isPrivilegedModApiPath(pathname) {
    return pathname === "/api/release/check" || pathname.startsWith("/api/mod/");
}

function isGithubNetworkApiPath(pathname) {
    return pathname === "/api/release/check"
        || pathname === "/api/mod/release-catalog"
        || pathname === "/api/mod/install-plan"
        || pathname === "/api/mod/verify-artifact"
        || pathname === "/api/mod/install-preflight"
        || pathname === "/api/mod/stage-artifact"
        || pathname === "/api/mod/install-confirmation"
        || pathname === "/api/mod/install-execution";
}

function hasGithubNetworkConsent(request) {
    const consent = headerValue(request?.headers?.["x-sidecar-network-consent"]).trim().toLowerCase();
    return ["github", "github-release", "release-artifact", "1", "true"].includes(consent);
}

function capabilityUnavailablePayload(capability) {
    return {
        ok: false,
        code: "profile_capability_unavailable",
        error: `${capability} is not available for the active Community Mod variant gate.`,
        capability,
        modProfile: communityModSettingsProfile,
        variantGate: {
            selectedProfile: communityModVariantGate.selectedProfile,
            installedProfile: communityModVariantGate.installedProfile,
            installedState: communityModVariantGate.installedState,
            mismatchKind: communityModVariantGate.mismatchKind,
            reasons: communityModVariantGate.capabilityReasons[capability] ?? [],
        },
    };
}

function variantGateCapabilityDetails(capability, reasons = []) {
    return [
        `Selected profile: ${communityModProfileLabel(communityModVariantGate.selectedProfile)}`,
        `Installed DLL: ${communityModProfileLabel(communityModVariantGate.installedProfile)} (${variantGateLabel(communityModVariantGate.installedState)})`,
        `Gate status: ${variantGateLabel(communityModVariantGate.mismatchKind)}`,
        ...reasons.map((reason) => variantGateReasonLabel(capability, reason)),
    ];
}

function communityModProfileLabel(profile) {
    if (profile === "netniv-basic") {
        return "Official Basic";
    }

    if (profile === "guff-advanced") {
        return "Guff Advanced";
    }

    if (profile === "none") {
        return "No DLL";
    }

    return "Unknown";
}

function variantGateReasonLabel(capability, reason) {
    if (capability === "battleLog") {
        switch (reason) {
            case "selected_profile_netniv-basic_does_not_support_battleLog":
                return "Official Basic selection does not include Battle Log.";
            case "selected_profile_guff-advanced_does_not_support_battleLog":
                return "Selected profile does not include Battle Log.";
            case "installed_profile_netniv-basic_does_not_support_battleLog":
                return "Installed Official Basic DLL does not include Battle Log.";
            case "installed_dll_unknown":
                return "Installed DLL is unknown.";
            case "installed_dll_missing":
                return "No Community Mod DLL is installed.";
            default:
                break;
        }
    }

    return `Gate reason: ${variantGateLabel(reason)}`;
}

function variantGateLabel(value) {
    return String(value ?? "unknown")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .replaceAll("Dll", "DLL")
        .replaceAll("Netniv", "netniV");
}

async function refreshCommunityModVariantGate() {
    communityModInstallStatus = await readCommunityModInstallStatus();
    communityModVariantGate = buildCommunityModVariantGateContext({
        install: communityModInstallStatus,
        selectedProfile: communityModSettingsProfile,
    });
    communityModCapabilities = communityModVariantGate.capabilities;
    await reconcileRuntimeSurfacesWithVariantGate();
    return { install: communityModInstallStatus, variantGate: communityModVariantGate };
}

async function reconcileRuntimeSurfacesWithVariantGate() {
    if (communityModCapabilities.eventStore) {
        if (!eventStore) {
            const nextStore = await createConfiguredEventStore();
            if (nextStore) {
                eventStore = nextStore;
                eventStoreRevision += 1;
            }
        }
    } else if (eventStore) {
        const closingStore = eventStore;
        eventStore = null;
        eventStoreRevision += 1;
        await closingStore.close().catch((error) => {
            console.warn(`[sidecar-viewer] unable to close event store: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    if (communityModCapabilities.battleLog) {
        ensureFeedWatcher();
    } else {
        closeFeedWatcher();
        feedIndex = createEmptyFeedIndex(feedPath);
    }
}

function sendEventStoreUnavailable(response) {
    return sendJson(response, 503, {
        ok: false,
        error: "Event store is unavailable for the active Community Mod variant gate.",
        retryAfterSeconds: 5,
    });
}

async function withCommunityModOperationLock(response, operation, handler) {
    const lockKey = path.resolve(gameDir).toLowerCase();
    if (communityModOperationLocks.has(lockKey)) {
        return sendJson(response, 409, {
            ok: false,
            status: "operation_in_progress",
            error: "Another Community Mod operation is already running for the selected game directory.",
            operation: communityModOperationLocks.get(lockKey),
            requestedOperation: operation,
            gameDir,
        });
    }

    communityModOperationLocks.set(lockKey, operation);
    try {
        return await handler();
    } finally {
        if (communityModOperationLocks.get(lockKey) === operation) {
            communityModOperationLocks.delete(lockKey);
        }
    }
}

async function readCommunityModInstallStatus() {
    try {
        return await detectCommunityModInstall(gameDir);
    } catch (error) {
        return {
            ok: false,
            state: "error",
            classification: "unknown",
            profile: "unknown",
            error: error instanceof Error ? error.message : String(error),
            generatedAt: new Date().toISOString(),
        };
    }
}

async function buildCurrentCommunityModInstallConfirmation(profile) {
    const [install, catalog] = await Promise.all([
        readCommunityModInstallStatus(),
        fetchCommunityModReleaseCatalog({ profile }),
    ]);
    const cacheDir = process.env.STFC_SIDECAR_CACHE_DIR || DEFAULT_ARTIFACT_CACHE_DIR;
    const installPlan = buildCommunityModInstallPlan({ profile, install, catalog });
    const gameProcess = await detectStfcGameProcess({ gameDirectory: gameDir });
    let artifactVerification = null;
    let artifactStaging = null;
    let preflight = buildCommunityModInstallPreflight({ installPlan, gameProcess });
    if (preflight.status === "artifact_not_verified") {
        artifactVerification = await verifyCommunityModArtifact({ catalog, cacheDir });
        if (artifactVerification.status === "verified") {
            artifactStaging = await stageCommunityModArtifact({ catalog, verification: artifactVerification, cacheDir });
        }
        preflight = buildCommunityModInstallPreflight({ installPlan, artifactVerification, gameProcess });
    }

    return buildCommunityModInstallConfirmation({
        installPlan,
        preflight,
        artifactStaging,
    });
}

async function buildCurrentCommunityModUninstallConfirmation(options = {}) {
    const install = await readCommunityModInstallStatus();
    const uninstallPlan = buildCommunityModUninstallPlan({ install });
    const gameProcess = await detectStfcGameProcess({ gameDirectory: gameDir });
    return buildCommunityModUninstallConfirmation({
        uninstallPlan,
        gameProcess,
        deleteSettingsAndLogs: options.deleteSettingsAndLogs,
        settingsFiles: uninstallPlan.settings?.files,
    });
}

async function readHotkeySettingsSnapshot() {
    const generatedAt = new Date().toISOString();
    const exists = existsSync(settingsPath);
    const contents = exists ? await readFile(settingsPath, "utf8") : "";
    const snapshot = buildCommunityModHotkeySettingsSnapshot(contents, { profile: communityModSettingsProfile });

    return {
        ...snapshot,
        generatedAt,
        settingsPath,
        exists,
        saveRequiresToken: settingsSaveMode === SETTINGS_SAVE_MODE_REMOTE_PROTECTED,
        settingsSaveMode,
        saveSupported: true,
        applyMode: "next_launch",
        modProfile: communityModSettingsProfile,
    };
}

async function readNotificationSettingsSnapshot() {
    const generatedAt = new Date().toISOString();
    const exists = existsSync(settingsPath);
    const contents = exists ? await readFile(settingsPath, "utf8") : "";
    const snapshot = buildCommunityModNotificationSettingsSnapshot(contents, { profile: communityModSettingsProfile });

    return {
        ...snapshot,
        generatedAt,
        settingsPath,
        exists,
        saveRequiresToken: settingsSaveMode === SETTINGS_SAVE_MODE_REMOTE_PROTECTED,
        settingsSaveMode,
        saveSupported: true,
        applyMode: "next_launch",
        modProfile: communityModSettingsProfile,
    };
}

async function readDiagnosticsBundle() {
    const generatedAt = new Date().toISOString();
    const [storedEvents, feed, settings] = await Promise.all([
        countStoredEvents(),
        communityModCapabilities.battleLog
            ? readEventsSnapshot(25, { includeDetails: false }).catch((error) => ({
                ok: false,
                exists: false,
                source: "unknown",
                error: error instanceof Error ? error.message : String(error),
            }))
            : Promise.resolve({
                ok: true,
                exists: false,
                source: "disabled",
                error: "Battle Log is not available for the active Community Mod profile.",
            }),
        readHotkeySettingsSnapshot().catch((error) => ({
            exists: false,
            parseError: true,
            saveSupported: false,
            settingsSaveMode,
            actions: [],
            hardSettings: [],
            error: error instanceof Error ? error.message : String(error),
        })),
    ]);

    return buildDiagnosticsBundle({
        generatedAt,
        release: releaseInfo,
        developerMode,
        companionMode,
        pid: process.pid,
        port,
        startedAt: startedAt.toISOString(),
        uptimeMs: Date.now() - startedAt.getTime(),
        eventStoreBackend: eventStore?.backend ?? "none",
        storedEvents,
        gameDir,
        feedPath,
        settingsPath,
        feed,
        settings,
    });
}

async function countStoredEvents() {
    const store = eventStore;
    const storeRevision = eventStoreRevision;
    if (!store) {
        return 0;
    }

    try {
        const count = await store.count();
        return store === eventStore && storeRevision === eventStoreRevision ? count : 0;
    } catch {
        return 0;
    }
}

async function handleHotkeySettingsUpdate(request, response) {
    if (!isAuthorizedSettingsRequest(request)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized settings request" });
    }

    try {
        const payload = await readJsonBody(request);
        const previousContents = existsSync(settingsPath) ? await readFile(settingsPath, "utf8") : "";
        const nextContents = applyCommunityModHotkeySettingsPatch(previousContents, payload, { profile: communityModSettingsProfile });
        await mkdir(path.dirname(settingsPath), { recursive: true });

        if (existsSync(settingsPath)) {
            await copyFile(settingsPath, `${settingsPath}.bak.sidecar`);
        }

        await writeFile(settingsPath, nextContents, "utf8");
        console.log(`[sidecar-viewer] updated hotkey settings ${settingsPath}`);
        return sendJson(response, 200, await readHotkeySettingsSnapshot());
    } catch (error) {
        return sendJson(response, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function handleNotificationSettingsUpdate(request, response) {
    if (!isAuthorizedSettingsRequest(request)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized settings request" });
    }

    try {
        const payload = await readJsonBody(request);
        const previousContents = existsSync(settingsPath) ? await readFile(settingsPath, "utf8") : "";
        const nextContents = applyCommunityModNotificationSettingsPatch(previousContents, payload, {
            profile: communityModSettingsProfile,
        });
        await mkdir(path.dirname(settingsPath), { recursive: true });

        if (existsSync(settingsPath)) {
            await copyFile(settingsPath, `${settingsPath}.bak.sidecar`);
        }

        await writeFile(settingsPath, nextContents, "utf8");
        console.log(`[sidecar-viewer] updated notification settings ${settingsPath}`);
        return sendJson(response, 200, await readNotificationSettingsSnapshot());
    } catch (error) {
        return sendJson(response, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function parseArgs(args) {
    let selectedGameDir = process.env.STFC_SIDECAR_GAME_DIR ?? "";
    let selectedFeedPath = process.env.STFC_SIDECAR_FEED_PATH ?? "";
    let selectedSettingsPath = process.env.STFC_SIDECAR_SETTINGS_PATH ?? "";
    let selectedPort = parseInteger(process.env.STFC_SIDECAR_PORT, DEFAULT_PORT);
    let selectedLimit = parseInteger(process.env.STFC_SIDECAR_LIMIT, DEFAULT_LIMIT);
    let selectedDeveloperMode = parseDeveloperModeFlag(process.env.STFC_SIDECAR_DEVELOPER_MODE);

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const nextValue = () => {
            if (index + 1 >= args.length) {
                console.error(`Missing value for ${arg}`);
                process.exit(2);
            }

            index += 1;
            return args[index];
        };

        if (arg === "--game-dir") {
            selectedGameDir = nextValue();
            continue;
        }

        if (arg === "--feed-path") {
            selectedFeedPath = nextValue();
            continue;
        }

        if (arg === "--settings-path") {
            selectedSettingsPath = nextValue();
            continue;
        }

        if (arg === "--port") {
            selectedPort = parseInteger(nextValue(), DEFAULT_PORT);
            continue;
        }

        if (arg === "--limit") {
            selectedLimit = parseInteger(nextValue(), DEFAULT_LIMIT);
            continue;
        }

        if (arg === "--developer-mode") {
            selectedDeveloperMode = true;
            continue;
        }

        if (arg === "--standard-mode") {
            selectedDeveloperMode = false;
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            console.log("Usage: node packages/viewer/server.mjs [--game-dir <dir>] [--feed-path <jsonl>] [--settings-path <toml>] [--port <number>] [--limit <number>] [--developer-mode|--standard-mode]");
            process.exit(0);
        }

        console.error(`Unknown argument: ${arg}`);
        process.exit(2);
    }

    const resolvedGameDir = resolveGameDir(selectedGameDir);
    const resolvedFeedPath = resolveFeedPath(selectedFeedPath || path.join(resolvedGameDir, DEFAULT_FEED_FILE));
    return {
        gameDir: resolvedGameDir,
        feedPath: resolvedFeedPath,
        settingsPath: resolveSettingsPath(selectedSettingsPath, resolvedFeedPath),
        port: selectedPort,
        defaultLimit: selectedLimit,
        developerMode: selectedDeveloperMode,
    };
}

function readPackageVersion() {
    try {
        const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        return packageJson.version;
    } catch {
        return "";
    }
}

function resolveGameDir(gameDir) {
    const platformPath = normalizeWindowsPathForWsl(gameDir || DEFAULT_GAME_DIR);
    return path.resolve(platformPath);
}

function resolveFeedPath(feedPath) {
    const platformPath = normalizeWindowsPathForWsl(feedPath);
    return path.resolve(platformPath);
}

function resolveSettingsPath(selectedSettingsPath, selectedFeedPath) {
    const settingsPathValue = selectedSettingsPath || path.join(path.dirname(selectedFeedPath), DEFAULT_SETTINGS_FILE);
    const platformPath = normalizeWindowsPathForWsl(settingsPathValue);
    return path.resolve(platformPath);
}

function resolveStoreConnection(connection) {
    return path.isAbsolute(connection) ? connection : path.resolve(repoRoot, connection);
}

function normalizeWindowsPathForWsl(feedPath) {
    if (process.platform !== "linux" || !isWsl()) {
        return feedPath;
    }

    const match = /^([A-Za-z]):[\\/](.*)$/.exec(feedPath);
    if (!match) {
        return feedPath;
    }

    return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}`;
}

function isWsl() {
    if (process.env.WSL_DISTRO_NAME) {
        return true;
    }

    try {
        return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
    } catch {
        return false;
    }
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function createEmptyFeedIndex(selectedFeedPath = "") {
    return {
        feedPath: selectedFeedPath,
        fileSize: 0,
        lastModifiedMs: 0,
        entries: [],
        pendingBuffer: Buffer.alloc(0),
        pendingStartOffset: 0,
        detailCache: new Map(),
    };
}

async function handleEventIngest(request, response) {
    const store = eventStore;
    const storeRevision = eventStoreRevision;
    if (!store) {
        return sendEventStoreUnavailable(response);
    }

    if (!isAuthorizedSyncRequest(request)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized sidecar sync request" });
    }

    try {
        const payload = await readJsonBody(request);
        const events = normalizeIncomingEvents(payload);
        if (store !== eventStore || storeRevision !== eventStoreRevision) {
            return sendEventStoreUnavailable(response);
        }

        const result = await store.append(events);
        broadcastEventUpdate("ingest", { appended: result.appended ?? events.length });
        return sendJson(response, 202, {
            ok: true,
            backend: store.backend,
            ...result,
        });
    } catch (error) {
        return sendJson(response, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function handleEventStream(request, response) {
    response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
        "x-accel-buffering": "no",
    });
    response.write(": connected\n\n");

    const client = {
        response,
        keepalive: setInterval(() => {
            response.write(`: keepalive ${new Date().toISOString()}\n\n`);
        }, STREAM_KEEPALIVE_MS),
    };
    client.keepalive.unref?.();
    eventStreamClients.add(client);
    sendEventStreamMessage(client, "ready", streamPayload("ready"));

    request.on("close", () => {
        clearInterval(client.keepalive);
        eventStreamClients.delete(client);
    });
}

function broadcastEventUpdate(reason, extra = {}) {
    if (eventStreamClients.size === 0) {
        return;
    }

    const payload = streamPayload(reason, extra);
    for (const client of eventStreamClients) {
        sendEventStreamMessage(client, "events-updated", payload);
    }
}

function streamPayload(reason, extra = {}) {
    return {
        ok: true,
        reason,
        generatedAt: new Date().toISOString(),
        ...extra,
    };
}

function sendEventStreamMessage(client, eventName, payload) {
    client.response.write(`event: ${eventName}\n`);
    client.response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function ensureFeedWatcher() {
    const target = watcherTargetForFeed(feedPath);
    if (!target || target === feedWatcherPath) {
        return;
    }

    closeFeedWatcher();
    try {
        feedWatcher = watch(target, { persistent: false }, (_eventType, filename) => {
            if (filename && !isFeedWatcherFilename(filename)) {
                return;
            }

            scheduleFeedWatcherUpdate();
        });
        feedWatcherPath = target;
        feedWatcher.on("error", (error) => {
            console.warn(`[sidecar-viewer] feed watcher failed: ${error instanceof Error ? error.message : String(error)}`);
            closeFeedWatcher();
        });
        console.log(`[sidecar-viewer] watching feed updates at ${target}`);
    } catch (error) {
        console.warn(`[sidecar-viewer] unable to watch feed updates: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function closeFeedWatcher() {
    if (feedWatcherDebounce) {
        clearTimeout(feedWatcherDebounce);
        feedWatcherDebounce = null;
    }

    if (feedWatcher) {
        feedWatcher.close();
        feedWatcher = null;
        feedWatcherPath = "";
    }
}

function watcherTargetForFeed(selectedFeedPath) {
    if (existsSync(selectedFeedPath)) {
        return selectedFeedPath;
    }

    const directory = path.dirname(selectedFeedPath);
    return existsSync(directory) ? directory : "";
}

function isFeedWatcherFilename(filename) {
    return path.basename(String(filename)) === path.basename(feedPath);
}

function scheduleFeedWatcherUpdate() {
    if (feedWatcherDebounce) {
        clearTimeout(feedWatcherDebounce);
    }

    feedWatcherDebounce = setTimeout(() => {
        feedWatcherDebounce = null;
        ensureFeedWatcher();
        broadcastEventUpdate("feed-changed");
    }, 250);
    feedWatcherDebounce.unref?.();
}

async function readEventsSnapshot(limit, options = {}) {
    const store = eventStore;
    const storeRevision = eventStoreRevision;
    if (store) {
        try {
            const snapshot = await readStoredSnapshot(store, storeRevision, limit, options);
            if (snapshot) {
                return snapshot;
            }
        } catch (error) {
            console.warn(`[sidecar-viewer] stored event snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return readFeedSnapshot(feedPath, limit, options);
}

async function readEventDetail(lineNumber) {
    const store = eventStore;
    const storeRevision = eventStoreRevision;
    if (store) {
        try {
            const detail = await readStoredEvent(store, storeRevision, lineNumber);
            if (detail) {
                return detail;
            }
        } catch (error) {
            console.warn(`[sidecar-viewer] stored event detail unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return readFeedLine(feedPath, lineNumber);
}

async function readStoredSnapshot(store, storeRevision, limit, options = {}) {
    if (!store) {
        return null;
    }

    const generatedAt = new Date().toISOString();
    const resolvedLimit = Math.min(Math.max(limit, 10), 500);
    const includeDetails = options.includeDetails !== false;
    const [totalLines, storedEvents] = await Promise.all([
        store.count(),
        store.listRecent(resolvedLimit),
    ]);

    if (store !== eventStore || storeRevision !== eventStoreRevision) {
        return null;
    }

    if (storedEvents.length === 0) {
        return null;
    }

    const events = storedEvents.map((entry) => includeDetails
        ? normalizeLine(entry.rawJson, entry.sequenceId)
        : summarizeLine(entry.rawJson, entry.sequenceId));

    return {
        ok: true,
        source: "store",
        storageBackend: store.backend,
        exists: true,
        detail: includeDetails ? "full" : "summary",
        generatedAt,
        pollHintMs: POLL_HINT_MS,
        totalLines,
        returnedLines: storedEvents.length,
        events,
    };
}

async function readStoredEvent(store, storeRevision, lineNumber) {
    if (!store) {
        return null;
    }

    const generatedAt = new Date().toISOString();
    const storedEvent = await store.getBySequenceId(lineNumber);
    if (store !== eventStore || storeRevision !== eventStoreRevision) {
        return null;
    }

    if (!storedEvent) {
        return null;
    }

    const totalLines = await store.count();
    if (store !== eventStore || storeRevision !== eventStoreRevision) {
        return null;
    }

    return {
        ok: true,
        source: "store",
        storageBackend: store.backend,
        exists: true,
        detail: "full",
        generatedAt,
        totalLines,
        event: normalizeLine(storedEvent.rawJson, storedEvent.sequenceId),
    };
}

function isAuthorizedSyncRequest(request) {
    return isSyncRequestAuthorized(request, syncToken);
}

function isAuthorizedSettingsRequest(request) {
    return isSettingsRequestAuthorized(request, { settingsSaveMode, settingsToken });
}

function isAuthorizedModRequest(request) {
    return isModRequestAuthorized(request, modToken);
}

function headerValue(value) {
    if (Array.isArray(value)) {
        return String(value[0] ?? "");
    }

    return String(value ?? "");
}

function parseSettingsSaveMode(value) {
    const mode = String(value ?? "").trim().toLowerCase();
    if (!mode || mode === "local" || mode === "local_trusted") {
        return SETTINGS_SAVE_MODE_LOCAL_TRUSTED;
    }

    if (mode === "remote" || mode === "remote_protected") {
        return SETTINGS_SAVE_MODE_REMOTE_PROTECTED;
    }

    console.warn(`[sidecar-viewer] unknown STFC_SIDECAR_SETTINGS_SAVE_MODE '${value}', using ${SETTINGS_SAVE_MODE_LOCAL_TRUSTED}`);
    return SETTINGS_SAVE_MODE_LOCAL_TRUSTED;
}

async function readJsonBody(request) {
    let totalBytes = 0;
    const chunks = [];

    for await (const chunk of request) {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        totalBytes += buffer.length;
        if (totalBytes > MAX_EVENT_INGEST_BYTES) {
            throw new Error(`Request body exceeds ${MAX_EVENT_INGEST_BYTES} bytes.`);
        }

        chunks.push(buffer);
    }

    if (chunks.length === 0) {
        throw new Error("Request body is empty.");
    }

    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readOptionalJsonBody(request) {
    let totalBytes = 0;
    const chunks = [];

    for await (const chunk of request) {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        totalBytes += buffer.length;
        if (totalBytes > MAX_EVENT_INGEST_BYTES) {
            throw new Error(`Request body exceeds ${MAX_EVENT_INGEST_BYTES} bytes.`);
        }

        chunks.push(buffer);
    }

    if (chunks.length === 0) {
        return {};
    }

    const body = Buffer.concat(chunks).toString("utf8").trim();
    return body ? JSON.parse(body) : {};
}

function normalizeIncomingEvents(payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    if (items.length === 0) {
        throw new Error("Expected at least one sidecar event.");
    }

    return items.map((item, index) => {
        if (!isSidecarEvent(item)) {
            throw new Error(`Item ${index + 1} is not a recognized sidecar event.`);
        }

        return item;
    });
}

async function readFeedSnapshot(selectedFeedPath, limit, options = {}) {
    const generatedAt = new Date().toISOString();
    const resolvedLimit = Math.min(Math.max(limit, 10), 500);
    const includeDetails = options.includeDetails !== false;

    if (!existsSync(selectedFeedPath)) {
        return {
            ok: false,
            feedPath: selectedFeedPath,
            exists: false,
            generatedAt,
            pollHintMs: POLL_HINT_MS,
            events: [],
            error: "Feed file not found. Start the STFC mod feed emitter or point the viewer at another JSONL file.",
        };
    }

    const { fileStat, visibleEntries } = await refreshFeedIndex(selectedFeedPath);
    const selectedEntries = visibleEntries.slice(-resolvedLimit);
    const events = includeDetails
        ? (await Promise.all(selectedEntries.map((entry) => hydrateIndexedEntry(selectedFeedPath, fileStat.size, entry)))).reverse()
        : selectedEntries.map(publicEntry).reverse();

    return {
        ok: true,
        feedPath: selectedFeedPath,
        exists: true,
        detail: includeDetails ? "full" : "summary",
        generatedAt,
        pollHintMs: POLL_HINT_MS,
        lastModified: fileStat.mtime.toISOString(),
        totalLines: visibleEntries.length,
        returnedLines: selectedEntries.length,
        events,
    };
}

async function readFeedLine(selectedFeedPath, lineNumber) {
    const generatedAt = new Date().toISOString();
    if (!existsSync(selectedFeedPath)) {
        return {
            ok: false,
            statusCode: 404,
            feedPath: selectedFeedPath,
            exists: false,
            generatedAt,
            error: "Feed file not found.",
        };
    }

    const { fileStat, visibleEntries } = await refreshFeedIndex(selectedFeedPath);
    const indexedEntry = visibleEntries.find((entry) => entry.lineNumber === lineNumber);

    if (!indexedEntry) {
        return {
            ok: false,
            statusCode: 404,
            feedPath: selectedFeedPath,
            exists: true,
            generatedAt,
            totalLines: visibleEntries.length,
            error: `Line ${lineNumber} is not available in the feed.`,
        };
    }

    return {
        ok: true,
        feedPath: selectedFeedPath,
        exists: true,
        detail: "full",
        generatedAt,
        lastModified: fileStat.mtime.toISOString(),
        totalLines: visibleEntries.length,
        event: await hydrateIndexedEntry(selectedFeedPath, fileStat.size, indexedEntry),
    };
}

async function refreshFeedIndex(selectedFeedPath) {
    const fileStat = await stat(selectedFeedPath);
    const needsReset = feedIndex.feedPath !== selectedFeedPath
        || fileStat.size < feedIndex.fileSize
        || fileStat.mtimeMs < feedIndex.lastModifiedMs;

    if (needsReset) {
        feedIndex = createEmptyFeedIndex(selectedFeedPath);
    }

    if (feedIndex.feedPath !== selectedFeedPath) {
        feedIndex.feedPath = selectedFeedPath;
    }

    if (fileStat.size > feedIndex.fileSize) {
        const chunk = await readFeedChunk(selectedFeedPath, feedIndex.fileSize, fileStat.size - feedIndex.fileSize);
        ingestFeedChunk(feedIndex, chunk, feedIndex.fileSize);
    }

    feedIndex.fileSize = fileStat.size;
    feedIndex.lastModifiedMs = fileStat.mtimeMs;

    return {
        fileStat,
        visibleEntries: visibleFeedEntries(feedIndex, fileStat.size),
    };
}

function ingestFeedChunk(index, chunk, chunkStartOffset) {
    const hasPending = index.pendingBuffer.length > 0;
    const combinedBuffer = hasPending ? Buffer.concat([index.pendingBuffer, chunk]) : chunk;
    const combinedStartOffset = hasPending ? index.pendingStartOffset : chunkStartOffset;

    let lineStart = 0;

    for (let cursor = 0; cursor < combinedBuffer.length; cursor += 1) {
        if (combinedBuffer[cursor] !== 0x0a) {
            continue;
        }

        let contentEnd = cursor;
        if (contentEnd > lineStart && combinedBuffer[contentEnd - 1] === 0x0d) {
            contentEnd -= 1;
        }

        appendIndexedLine(
            index,
            combinedBuffer.subarray(lineStart, contentEnd),
            combinedStartOffset + lineStart,
            combinedStartOffset + contentEnd,
        );
        lineStart = cursor + 1;
    }

    index.pendingBuffer = combinedBuffer.subarray(lineStart);
    index.pendingStartOffset = combinedStartOffset + lineStart;
}

function appendIndexedLine(index, rawLineBuffer, startOffset, endOffset) {
    const rawLine = rawLineBuffer.toString("utf8");
    if (rawLine.trim().length === 0) {
        return;
    }

    const summaryEntry = summarizeLine(rawLine, index.entries.length + 1);
    index.entries.push({
        ...summaryEntry,
        startOffset,
        endOffset,
    });
}

function visibleFeedEntries(index, fileSize) {
    const entries = [...index.entries];
    const pendingEntry = pendingFeedEntry(index, fileSize);
    if (pendingEntry) {
        entries.push(pendingEntry);
    }
    return entries;
}

function pendingFeedEntry(index, fileSize) {
    if (index.pendingBuffer.length === 0) {
        return null;
    }

    const rawLine = index.pendingBuffer.toString("utf8");
    if (rawLine.trim().length === 0) {
        return null;
    }

    return {
        ...summarizeLine(rawLine, index.entries.length + 1),
        startOffset: index.pendingStartOffset,
        endOffset: fileSize,
    };
}

async function hydrateIndexedEntry(selectedFeedPath, fileSize, entry) {
    if (!entry.parsed) {
        const rawLine = await readIndexedRawLine(selectedFeedPath, fileSize, entry);
        return normalizeLine(rawLine, entry.lineNumber);
    }

    const cached = feedIndex.detailCache.get(entry.lineNumber);
    if (cached) {
        return cached;
    }

    const rawLine = await readIndexedRawLine(selectedFeedPath, fileSize, entry);
    const normalizedEntry = normalizeLine(rawLine, entry.lineNumber);
    rememberDetailEntry(normalizedEntry);
    return normalizedEntry;
}

async function readIndexedRawLine(selectedFeedPath, fileSize, entry) {
    const pendingEntry = pendingFeedEntry(feedIndex, fileSize);
    if (pendingEntry && pendingEntry.lineNumber === entry.lineNumber) {
        return feedIndex.pendingBuffer.toString("utf8");
    }

    const length = Math.max(0, entry.endOffset - entry.startOffset);
    const lineBuffer = await readFeedChunk(selectedFeedPath, entry.startOffset, length);
    return lineBuffer.toString("utf8");
}

async function readFeedChunk(selectedFeedPath, offset, length) {
    if (length <= 0) {
        return Buffer.alloc(0);
    }

    const handle = await open(selectedFeedPath, "r");
    try {
        const buffer = Buffer.alloc(length);
        let totalBytesRead = 0;

        while (totalBytesRead < length) {
            const { bytesRead } = await handle.read(buffer, totalBytesRead, length - totalBytesRead, offset + totalBytesRead);
            if (bytesRead === 0) {
                break;
            }

            totalBytesRead += bytesRead;
        }

        return totalBytesRead === buffer.length ? buffer : buffer.subarray(0, totalBytesRead);
    } finally {
        await handle.close();
    }
}

function rememberDetailEntry(entry) {
    feedIndex.detailCache.delete(entry.lineNumber);
    feedIndex.detailCache.set(entry.lineNumber, entry);

    while (feedIndex.detailCache.size > DETAIL_CACHE_LIMIT) {
        const oldestLineNumber = feedIndex.detailCache.keys().next().value;
        feedIndex.detailCache.delete(oldestLineNumber);
    }
}

function publicEntry(entry) {
    const { startOffset: _startOffset, endOffset: _endOffset, ...value } = entry;
    return value;
}

function summarizeLine(rawLine, lineNumber) {
    const parsed = parseEventJsonLine(rawLine);
    if (!parsed.ok) {
        return {
            lineNumber,
            parsed: false,
            error: parsed.error,
            rawPreview: rawLine.slice(0, 240),
            summary: {
                title: "Unrecognized JSONL line",
                subtitle: parsed.error,
                chips: ["invalid"],
            },
        };
    }

    return {
        lineNumber,
        parsed: true,
        detail: "summary",
        ...eventIndex(parsed.event),
        summary: summarizeEvent(parsed.event),
    };
}

function normalizeLine(rawLine, lineNumber) {
    const parsed = parseEventJsonLine(rawLine);
    if (!parsed.ok) {
        return {
            lineNumber,
            rawLine,
            parsed: false,
            error: parsed.error,
            summary: {
                title: "Unrecognized JSONL line",
                subtitle: parsed.error,
                chips: ["invalid"],
            },
        };
    }

    return {
        lineNumber,
        rawLine,
        parsed: true,
        detail: "full",
        ...eventIndex(parsed.event),
        event: parsed.event,
        summary: summarizeEvent(parsed.event),
    };
}

function eventIndex(event) {
    return {
        eventType: event.type,
        battleId: event.battleId ?? null,
        journalId: event.journalId ?? null,
        battleType: event.battleType ?? null,
        timestamp: event.timestamp ?? null,
    };
}

function summarizeEvent(event) {
    if (event.type === "battle.capture") {
        const capture = asRecord(event.capture);
        const summary = asRecord(capture.summary);
        const battleLog = asRecord(capture.battleLog);
        const tokens = Array.isArray(battleLog.tokens) ? battleLog.tokens : [];
        const participants = Array.isArray(capture.participants) ? capture.participants : [];
        const targetLabel = asText(summary.targetId) || asText(event.battleId) || `Battle capture ${event.journalId}`;

        return {
            title: targetLabel,
            subtitle: `${participants.length} participant${participants.length === 1 ? "" : "s"} captured`,
            chips: [event.type, `battleType ${event.battleType ?? "?"}`, `${tokens.length} tokens`],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "battle.report") {
        const summary = asRecord(event.report?.summary);
        const fleets = Array.isArray(event.report?.fleets) ? event.report.fleets : [];
        const hostile = fleets.find((fleet) => isHostileFleet(fleet)) ?? fleets.find((fleet) => asText(fleet.uid).startsWith("mar_"));
        const playerNames = fleets
            .filter((fleet) => asText(fleet.participant_kind) === "player")
            .map((fleet) => asText(fleet.display_name) || asText(fleet.name))
            .filter(Boolean);
        const targetLabel = asText(hostile?.display_name) || asText(hostile?.name) || asText(summary.targetId) || `Battle ${event.journalId}`;
        const outcome = asText(summary.outcome) || "unknown_outcome";

        return {
            title: targetLabel,
            subtitle: playerNames.length > 0 ? playerNames.join(", ") : "No player participants recorded",
            chips: [event.type, `battleType ${event.battleType ?? "?"}`, outcome],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "battle.analytics") {
        const analytics = asRecord(event.analytics);
        const csvParity = asRecord(analytics.csvParity);
        const rows = Array.isArray(csvParity.rows) ? csvParity.rows : [];
        const summary = asRecord(analytics.summary);
        const targetLabel = asText(summary.targetId) || asText(event.battleId) || `Battle analytics ${event.journalId}`;

        return {
            title: targetLabel,
            subtitle: `${rows.length} Prime CSV parity row${rows.length === 1 ? "" : "s"}`,
            chips: [event.type, `battleType ${event.battleType ?? "?"}`, asText(csvParity.status) || "analytics"],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "catalog.snapshot") {
        const catalog = asRecord(event.catalog);
        const coverage = asRecord(catalog.coverage);
        const present = Array.isArray(coverage.domainsPresent) ? coverage.domainsPresent : [];
        const total = Number(coverage.totalEntries ?? 0);
        const resolved = Number(coverage.resolvedEntries ?? 0);

        return {
            title: `Catalog snapshot for battle ${event.battleId ?? event.journalId}`,
            subtitle: `${present.length} domain${present.length === 1 ? "" : "s"} | ${resolved}/${total} entries resolved`,
            chips: [event.type, asText(event.scope) || "battle", `battleType ${event.battleType ?? "?"}`],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "debug.event") {
        return {
            title: event.message,
            subtitle: event.source,
            chips: [event.type, event.level],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "hook.event") {
        return {
            title: event.hookName,
            subtitle: event.backend ?? "hook status",
            chips: [event.type, event.status],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "battle.event") {
        return {
            title: event.playerShip ?? event.enemy ?? event.battleId ?? "battle.event",
            subtitle: event.rawLine ?? event.phase,
            chips: [event.type, event.phase],
            timestamp: event.timestamp,
        };
    }

    if (event.type === "session.event") {
        return {
            title: event.phase,
            subtitle: event.sessionId ?? "session event",
            chips: [event.type],
            timestamp: event.timestamp,
        };
    }

    return {
        title: event.action,
        subtitle: event.provider,
        chips: [event.type, event.status],
        timestamp: event.timestamp,
    };
}

function isHostileFleet(fleet) {
    return asText(fleet?.participant_kind) === "hostile" || asText(fleet?.uid).startsWith("mar_");
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asText(value) {
    return typeof value === "string" ? value : "";
}

async function resolvePublicAsset(pathname) {
    for (const relativePath of publicPathCandidates(pathname)) {
        const filePath = path.resolve(publicDir, `.${relativePath}`);
        if (!isWithinPublicDir(filePath)) {
            continue;
        }

        try {
            const fileStat = await stat(filePath);
            if (!fileStat.isFile()) {
                continue;
            }

            return {
                filePath,
                contentType: contentTypeForPath(filePath),
            };
        } catch {
            continue;
        }
    }

    return null;
}

function publicPathCandidates(pathname) {
    const decodedPathname = decodeURIComponent(pathname);
    if (decodedPathname === "/") {
        return ["/index.html"];
    }

    if (path.extname(decodedPathname)) {
        return [decodedPathname];
    }

    const normalizedPathname = decodedPathname.endsWith("/") ? decodedPathname.slice(0, -1) : decodedPathname;
    return [`${normalizedPathname}/index.html`, decodedPathname];
}

function isWithinPublicDir(filePath) {
    const relativePath = path.relative(publicDir, filePath);
    return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function contentTypeForPath(filePath) {
    switch (path.extname(filePath).toLowerCase()) {
        case ".html":
            return "text/html; charset=utf-8";
        case ".js":
        case ".mjs":
            return "text/javascript; charset=utf-8";
        case ".css":
            return "text/css; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".svg":
            return "image/svg+xml";
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".ico":
            return "image/x-icon";
        default:
            return "application/octet-stream";
    }
}

function isAuthorizedShutdownRequest(request) {
    return isShutdownRequestAuthorized(request, shutdownToken);
}

async function shutdownServer(reason) {
    if (shutdownRequested) {
        return;
    }

    shutdownRequested = true;
    closeFeedWatcher();
    for (const client of eventStreamClients) {
        clearInterval(client.keepalive);
        client.response.end();
    }
    eventStreamClients.clear();
    console.log(`[sidecar-viewer] shutdown requested (${reason})`);

    exitTimer = setTimeout(() => {
        console.error("[sidecar-viewer] shutdown timed out; closing active connections");
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
        process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    exitTimer.unref();

    server.close((error) => {
        if (exitTimer) {
            clearTimeout(exitTimer);
        }

        if (error) {
            console.error(`[sidecar-viewer] shutdown failed: ${error.message}`);
            process.exit(1);
            return;
        }

        console.log("[sidecar-viewer] shutdown complete");
        process.exit(0);
    });
}

async function sendFile(response, filePath, contentType) {
    try {
        const body = await readFile(filePath);
        response.writeHead(200, {
            "content-type": contentType,
            "cache-control": "no-store",
        });
        response.end(body);
    } catch (error) {
        sendJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    response.end(JSON.stringify(value));
}

function sendText(response, statusCode, value, contentType) {
    response.writeHead(statusCode, {
        "content-type": contentType,
        "cache-control": "no-store",
    });
    response.end(value);
}
