import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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
import { createCloudTelemetryBridge } from "./cloud-telemetry.mjs";
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
import { installBoundedConsoleLogSync } from "./bounded-log-file.mjs";
import { createMajelIngestStore } from "./majel-ingest-store.mjs";
import { createFeedWatcher } from "./server/feed-watcher.mjs";
import { handleDiagnosticsRoutes } from "./server/routes/diagnostics-routes.mjs";
import { handleEventRoutes } from "./server/routes/event-routes.mjs";
import { handleHealthRoutes } from "./server/routes/health-routes.mjs";
import { handleMajelRoutes } from "./server/routes/majel-routes.mjs";
import { handleModInstallRoutes } from "./server/routes/mod-install-routes.mjs";
import { handleModUninstallRoutes } from "./server/routes/mod-uninstall-routes.mjs";
import { handleSettingsRoutes } from "./server/routes/settings-routes.mjs";
import { resolvePublicAsset, sendFile, sendJson, sendText } from "./server/static-files.mjs";

const DEFAULT_GAME_DIR = "C:\\Games\\Star Trek Fleet Command\\default\\game";
const DEFAULT_FEED_FILE = "community_patch_battle_feed.jsonl";
const DEFAULT_FEED_PATH = path.join(DEFAULT_GAME_DIR, DEFAULT_FEED_FILE);
const DEFAULT_SETTINGS_FILE = "community_patch_settings.toml";
const DEFAULT_PORT = 43127;
const DEFAULT_LIMIT = 150;
const DEFAULT_STORE_PATH = "./.sidecar/sidecar-events.sqlite";
const SETTINGS_SAVE_MODE_LOCAL_TRUSTED = "local_trusted";
const SETTINGS_SAVE_MODE_REMOTE_PROTECTED = "remote_protected";
const MAX_EVENT_INGEST_BYTES = 5 * 1024 * 1024;
const POLL_HINT_MS = 2000;
const STREAM_KEEPALIVE_MS = 30000;
const SHUTDOWN_GRACE_MS = 5000;
const BATTLE_EVENT_TYPES = Object.freeze(["battle.event", "battle.capture", "battle.analytics", "battle.report", "catalog.snapshot"]);
const DEVELOPER_EVENT_TYPE_LIST = Object.freeze(["debug.event", "hook.event", "session.event", "integration.event"]);
const ALL_EVENT_TYPES = Object.freeze([...BATTLE_EVENT_TYPES, ...DEVELOPER_EVENT_TYPE_LIST]);
const DEVELOPER_EVENT_TYPES = new Set(DEVELOPER_EVENT_TYPE_LIST);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const publicDir = path.join(__dirname, "public");
const DEFAULT_ARTIFACT_CACHE_DIR = path.join(repoRoot, ".sidecar", "mod-artifacts");

installBoundedConsoleLogSync(process.env.STFC_SIDECAR_PROCESS_LOG_PATH?.trim() ?? "");

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
const cloudTelemetryBridge = createCloudTelemetryBridge({
    env: process.env,
    gameDir,
    sidecarVersion: releaseInfo.version,
    logger: console,
});
const eventStreamClients = new Set();
const majelStreamClients = new Set();
const communityModOperationLocks = new Map();

let shutdownRequested = false;
let exitTimer;

let createSqlSidecarEventStore;
let applyCommunityModDiagnosticSettingsPatch;
let applyCommunityModHotkeySettingsPatch;
let applyCommunityModNotificationSettingsPatch;
let buildCommunityModDiagnosticSettingsSnapshot;
let buildCommunityModHotkeySettingsSnapshot;
let buildCommunityModNotificationSettingsSnapshot;
let normalizeCommunityModSettingsProfile;
let isSidecarEvent;
let parseEventJsonLine;
try {
    ({
        applyCommunityModDiagnosticSettingsPatch,
        applyCommunityModHotkeySettingsPatch,
        applyCommunityModNotificationSettingsPatch,
        buildCommunityModDiagnosticSettingsSnapshot,
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

const battleFeed = createFeedWatcher({
    feedPath,
    normalizeLine,
    onFeedChanged: () => broadcastEventUpdate("feed-changed"),
    pollHintMs: POLL_HINT_MS,
    summarizeLine,
});

const communityModSettingsProfile = normalizeCommunityModSettingsProfile(process.env.STFC_SIDECAR_MOD_PROFILE);
let communityModInstallStatus = await readCommunityModInstallStatus();
let communityModVariantGate = buildCommunityModVariantGateContext({
    install: communityModInstallStatus,
    selectedProfile: communityModSettingsProfile,
});
let communityModCapabilities = communityModVariantGate.capabilities;
let eventStore = await createConfiguredEventStore();
let eventStoreRevision = 0;
const majelIngestStore = createMajelIngestStore();

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

    if (await handleEventRoutes(request, response, requestUrl, {
        defaultLimit,
        developerMode,
        developerModeRequiredPayload,
        handleEventIngest,
        handleEventStream,
        handleFleetSyncIngest,
        readEventDetail,
        readEventsSnapshot,
    })) {
        return;
    }

    if (await handleMajelRoutes(request, response, requestUrl, {
        defaultLimit,
        handleMajelIngest,
        handleMajelStream,
        readMajelDetail,
        readMajelSnapshot,
    })) {
        return;
    }

    if (await handleSettingsRoutes(request, response, requestUrl, {
        developerMode,
        developerModeRequiredPayload,
        handleDiagnosticSettingsUpdate,
        handleHotkeySettingsUpdate,
        handleNotificationSettingsUpdate,
        readDiagnosticSettingsSnapshot,
        readHotkeySettingsSnapshot,
        readNotificationSettingsSnapshot,
    })) {
        return;
    }

    if (await handleDiagnosticsRoutes(request, response, requestUrl, {
        buildDiagnosticsMarkdown,
        readDiagnosticsBundle,
    })) {
        return;
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

    if (await handleModInstallRoutes(request, response, requestUrl, {
        buildCommunityModInstallExecutionBlocked,
        buildCommunityModInstallExecutionRequest,
        buildCommunityModInstallPlan,
        buildCommunityModInstallPreflight,
        buildCurrentCommunityModInstallConfirmation,
        communityModSettingsProfile,
        defaultArtifactCacheDir: DEFAULT_ARTIFACT_CACHE_DIR,
        detectStfcGameProcess,
        executeCommunityModInstall,
        fetchCommunityModReleaseCatalog,
        gameDir,
        normalizeCommunityModReleaseProfile,
        process,
        readCommunityModInstallStatus,
        readJsonBody,
        refreshCommunityModVariantGate,
        stageCommunityModArtifact,
        verifyCommunityModArtifact,
        withCommunityModOperationLock,
    })) {
        return;
    }

    if (await handleModUninstallRoutes(request, response, requestUrl, {
        buildCommunityModUninstallExecutionBlocked,
        buildCommunityModUninstallExecutionRequest,
        buildCommunityModUninstallPlan,
        buildCurrentCommunityModUninstallConfirmation,
        detectStfcGameProcess,
        executeCommunityModUninstall,
        gameDir,
        process,
        readCommunityModInstallStatus,
        readJsonBody,
        readOptionalJsonBody,
        refreshCommunityModVariantGate,
        withCommunityModOperationLock,
    })) {
        return;
    }

    if (await handleHealthRoutes(request, response, requestUrl, {
        cloudTelemetryBridge,
        companionMode,
        communityModSettingsProfile,
        countStoredEvents,
        defaultLimit,
        developerMode,
        feedPath,
        gameDir,
        getCommunityModCapabilities: () => communityModCapabilities,
        getEventStoreBackend: () => eventStore?.backend ?? "none",
        isAuthorizedShutdownRequest,
        isShutdownRequested: () => shutdownRequested,
        pollHintMs: POLL_HINT_MS,
        port,
        process,
        refreshCommunityModVariantGate,
        releaseInfo,
        settingsPath,
        shutdownServer,
        shutdownToken,
        startedAt,
    })) {
        return;
    }

    if (requestUrl.pathname === "/api/dev/ax") {
        if (request.method && request.method !== "GET") {
            return sendJson(response, 405, { ok: false, error: "Method not allowed" });
        }

        return sendJson(response, 200, await readAxPackage(requestUrl));
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
            cloudTelemetry: cloudTelemetryBridge.status(),
            generatedAt: new Date().toISOString(),
        });
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

    const publicAsset = await resolvePublicAsset(publicDir, requestUrl.pathname);
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
        battleFeed.ensure();
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
    return pathname.startsWith("/api/mod/");
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
        return "Basic";
    }

    if (profile === "waffle-basic") {
        return "Waffle Basic";
    }

    if (["waffle-advanced", "guff-advanced"].includes(profile)) {
        return "Waffle Advanced";
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
                return "Basic selection does not include Battle Log.";
            case "selected_profile_waffle-basic_does_not_support_battleLog":
                return "Waffle Basic selection does not include Battle Log.";
            case "selected_profile_waffle-advanced_does_not_support_battleLog":
                return "Selected profile does not include Battle Log.";
            case "installed_profile_netniv-basic_does_not_support_battleLog":
                return "Installed Basic DLL does not include Battle Log.";
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
        battleFeed.ensure();
    } else {
        battleFeed.close();
        battleFeed.resetIndex(feedPath);
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
    const saveSupported = Boolean(settingsPath);
    const exists = saveSupported && existsSync(settingsPath);
    const contents = exists ? await readFile(settingsPath, "utf8") : "";
    const snapshot = buildCommunityModHotkeySettingsSnapshot(contents, { profile: communityModSettingsProfile });

    return {
        ...snapshot,
        generatedAt,
        settingsPath,
        exists,
        saveRequiresToken: settingsSaveMode === SETTINGS_SAVE_MODE_REMOTE_PROTECTED,
        settingsSaveMode,
        saveSupported,
        error: saveSupported ? undefined : "Select an STFC game directory before editing settings.",
        applyMode: "next_launch",
        modProfile: communityModSettingsProfile,
    };
}

async function readNotificationSettingsSnapshot() {
    const generatedAt = new Date().toISOString();
    const saveSupported = Boolean(settingsPath);
    const exists = saveSupported && existsSync(settingsPath);
    const contents = exists ? await readFile(settingsPath, "utf8") : "";
    const snapshot = buildCommunityModNotificationSettingsSnapshot(contents, { profile: communityModSettingsProfile });

    return {
        ...snapshot,
        generatedAt,
        settingsPath,
        exists,
        saveRequiresToken: settingsSaveMode === SETTINGS_SAVE_MODE_REMOTE_PROTECTED,
        settingsSaveMode,
        saveSupported,
        error: saveSupported ? undefined : "Select an STFC game directory before editing settings.",
        applyMode: "next_launch",
        modProfile: communityModSettingsProfile,
    };
}

async function readDiagnosticSettingsSnapshot() {
    const generatedAt = new Date().toISOString();
    const saveSupported = Boolean(settingsPath);
    const exists = saveSupported && existsSync(settingsPath);
    const contents = exists ? await readFile(settingsPath, "utf8") : "";
    const snapshot = buildCommunityModDiagnosticSettingsSnapshot(contents, { profile: communityModSettingsProfile });

    return {
        ...snapshot,
        generatedAt,
        settingsPath,
        exists,
        saveRequiresToken: settingsSaveMode === SETTINGS_SAVE_MODE_REMOTE_PROTECTED,
        settingsSaveMode,
        saveSupported,
        error: saveSupported ? undefined : "Select an STFC game directory before editing settings.",
        applyMode: "next_launch",
        modProfile: communityModSettingsProfile,
        developerMode,
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

async function readAxPackage(requestUrl) {
    const generatedAt = new Date().toISOString();
    const limit = parseBoundedInteger(requestUrl.searchParams.get("limit"), 10, 10, 100);
    const battleLimit = parseAxScopeLimit(requestUrl.searchParams.get("battleLimit"), limit);
    const debugLimit = parseAxScopeLimit(requestUrl.searchParams.get("debugLimit"), limit);

    const [eventStoreSummary, battleSnapshot, debugSnapshot] = await Promise.all([
        readAxEventStoreSummary(),
        battleLimit > 0
            ? readEventsSnapshot(battleLimit, { includeDetails: false, eventTypes: BATTLE_EVENT_TYPES })
            : emptyEventsSnapshot({ includeDetails: false }),
        debugLimit > 0
            ? readEventsSnapshot(debugLimit, { includeDetails: false, eventTypes: DEVELOPER_EVENT_TYPE_LIST })
            : emptyEventsSnapshot({ includeDetails: false }),
    ]);

    return {
        ok: true,
        packageType: "stfc.sidecar.ax.package.v0",
        generatedAt,
        sidecar: {
            pid: process.pid,
            port,
            startedAt: startedAt.toISOString(),
            uptimeMs: Date.now() - startedAt.getTime(),
            developerMode,
            companionMode,
            modProfile: communityModSettingsProfile,
            settingsProfile: communityModSettingsProfile,
            release: releaseInfo,
        },
        capabilities: {
            effective: communityModCapabilities,
            capabilityBits: communityModVariantGate.capabilityBits,
            variantGate: communityModVariantGate,
        },
        paths: {
            gameDir,
            feedPath,
            settingsPath,
        },
        eventStore: eventStoreSummary,
        contract: buildAxContractSummary(),
        scopes: {
            battle: buildAxScopePackage("battle", battleSnapshot, BATTLE_EVENT_TYPES),
            debug: buildAxScopePackage("debug", debugSnapshot, DEVELOPER_EVENT_TYPE_LIST),
        },
        endpoints: buildAxEndpointCatalog({ limit, battleLimit, debugLimit }),
        notes: buildAxPackageNotes(eventStoreSummary),
    };
}

async function readAxEventStoreSummary() {
    const store = eventStore;
    const storeRevision = eventStoreRevision;
    if (!store) {
        return {
            available: false,
            backend: "none",
            totalEvents: 0,
            scopes: {
                all: { totalEvents: 0 },
                battle: { totalEvents: 0, eventTypes: BATTLE_EVENT_TYPES },
                debug: { totalEvents: 0, eventTypes: DEVELOPER_EVENT_TYPE_LIST },
            },
            eventTypes: {},
        };
    }

    try {
        const [totalEvents, ...typeCounts] = await Promise.all([
            store.count(),
            ...ALL_EVENT_TYPES.map((eventType) => store.countByTypes([eventType])),
        ]);
        if (store !== eventStore || storeRevision !== eventStoreRevision) {
            return readAxEventStoreSummary();
        }

        const eventTypes = Object.fromEntries(ALL_EVENT_TYPES.map((eventType, index) => [eventType, typeCounts[index] ?? 0]));
        const battleTotal = BATTLE_EVENT_TYPES.reduce((sum, eventType) => sum + (eventTypes[eventType] ?? 0), 0);
        const debugTotal = DEVELOPER_EVENT_TYPE_LIST.reduce((sum, eventType) => sum + (eventTypes[eventType] ?? 0), 0);
        return {
            available: true,
            backend: store.backend,
            totalEvents,
            scopes: {
                all: { totalEvents },
                battle: { totalEvents: battleTotal, eventTypes: BATTLE_EVENT_TYPES },
                debug: { totalEvents: debugTotal, eventTypes: DEVELOPER_EVENT_TYPE_LIST },
            },
            eventTypes,
        };
    } catch (error) {
        return {
            available: false,
            backend: store.backend,
            totalEvents: 0,
            scopes: {
                all: { totalEvents: 0 },
                battle: { totalEvents: 0, eventTypes: BATTLE_EVENT_TYPES },
                debug: { totalEvents: 0, eventTypes: DEVELOPER_EVENT_TYPE_LIST },
            },
            eventTypes: {},
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function buildAxContractSummary() {
    return {
        contractVersion: "stfc.sidecar.producer-consumer-security.v0",
        contractDoc: "docs/22-producer-consumer-security-contract.md",
        priorityOrder: ["privacy-security", "producer-cost", "AX", "UI"],
        producer: "community-mod",
        consumer: "sidecar-core",
        dataPlane: {
            direction: "producer-to-consumer",
            eventPayloadsContainSecrets: false,
            bestEffortProducer: true,
            backpressureRule: "drop-sample-degrade-or-disable-optional-export-before-blocking-gameplay",
        },
        keyClasses: {
            localSync: "sidecar-generated local ingest key; never a provider credential",
            remoteSync: "remote-generated or user-provisioned target key; never reuse local sidecar sync key",
            localCapability: "sidecar-generated privileged local API key",
            providerCredential: "sidecar-owned provider/profile secret stored out-of-band",
            gameSessionSecret: "mod-only Scopely/game secret; never emitted to sidecar events",
        },
        forbidden: [
            "sidecar-to-mod-gameplay-commands",
            "secrets-in-event-payloads",
            "remote-egress-without-explicit-target-or-user-action",
            "sidecar-availability-as-mod-startup-requirement",
            "loopback-as-authorization",
        ],
    };
}

function buildAxScopePackage(scope, snapshot, eventTypes) {
    const events = Array.isArray(snapshot.events) ? snapshot.events.map(axEventSummary) : [];
    return {
        ok: snapshot.ok === true,
        scope,
        source: snapshot.source ?? "unknown",
        storageBackend: snapshot.storageBackend ?? null,
        exists: snapshot.exists === true,
        detail: snapshot.detail ?? "summary",
        eventTypes: [...eventTypes],
        totalLines: Number(snapshot.totalLines ?? 0),
        returnedLines: Number(snapshot.returnedLines ?? events.length),
        generatedAt: snapshot.generatedAt ?? null,
        events,
        error: snapshot.error ?? null,
    };
}

function axEventSummary(entry) {
    return {
        lineNumber: entry.lineNumber ?? null,
        eventType: entry.eventType ?? entry.event?.type ?? null,
        timestamp: entry.timestamp ?? entry.event?.timestamp ?? null,
        source: entry.source ?? entry.event?.source ?? null,
        level: entry.level ?? entry.event?.level ?? null,
        sessionId: entry.sessionId ?? entry.event?.sessionId ?? null,
        battleId: entry.battleId ?? entry.event?.battleId ?? null,
        journalId: entry.journalId ?? entry.event?.journalId ?? null,
        battleType: entry.battleType ?? entry.event?.battleType ?? null,
        summary: entry.summary ?? null,
    };
}

function buildAxEndpointCatalog({ limit, battleLimit, debugLimit }) {
    return {
        ready: "/api/health/ready",
        health: "/api/health",
        axPackage: `/api/dev/ax?limit=${limit}`,
        events: {
            battle: `/api/events?scope=battle&detail=summary&limit=${battleLimit}`,
            debug: `/api/events?scope=debug&detail=summary&limit=${debugLimit}`,
            all: `/api/events?scope=all&detail=summary&limit=${limit}`,
            detailTemplate: "/api/events/{lineNumber}?scope=battle|debug|all",
            stream: "/api/events/stream",
            ingest: "POST /api/events",
        },
    };
}

function buildAxPackageNotes(eventStoreSummary) {
    const notes = [];
    if (!eventStoreSummary.available) {
        notes.push("Event store is unavailable; debug/runtime event history will be limited or absent.");
    }

    if ((eventStoreSummary.scopes?.debug?.totalEvents ?? 0) === 0) {
        notes.push("No runtime diagnostic events are currently stored. Use AX sidecar-export with -Post while developer mode is enabled to seed this surface.");
    }

    return notes;
}

function parseBoundedInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, min), max);
}

function parseAxScopeLimit(value, fallback) {
    const parsed = parseBoundedInteger(value, fallback, 0, 100);
    return parsed > 0 ? Math.max(parsed, 10) : 0;
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
    if (!settingsPath) {
        return sendJson(response, 400, { ok: false, error: "Select an STFC game directory before editing settings." });
    }

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
    if (!settingsPath) {
        return sendJson(response, 400, { ok: false, error: "Select an STFC game directory before editing settings." });
    }

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

async function handleDiagnosticSettingsUpdate(request, response) {
    if (!developerMode) {
        return sendJson(response, 403, developerModeRequiredPayload());
    }

    if (!isAuthorizedSettingsRequest(request)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized settings request" });
    }

    if (!settingsPath) {
        return sendJson(response, 400, { ok: false, error: "Select an STFC game directory before editing settings." });
    }

    try {
        const payload = await readJsonBody(request);
        const previousContents = existsSync(settingsPath) ? await readFile(settingsPath, "utf8") : "";
        const nextContents = applyCommunityModDiagnosticSettingsPatch(previousContents, payload, {
            profile: communityModSettingsProfile,
        });
        await mkdir(path.dirname(settingsPath), { recursive: true });

        if (existsSync(settingsPath)) {
            await copyFile(settingsPath, `${settingsPath}.bak.sidecar`);
        }

        await writeFile(settingsPath, nextContents, "utf8");
        console.log(`[sidecar-viewer] updated diagnostic settings ${settingsPath}`);
        return sendJson(response, 200, await readDiagnosticSettingsSnapshot());
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
    const defaultFeedPath = resolvedGameDir ? path.join(resolvedGameDir, DEFAULT_FEED_FILE) : "";
    const resolvedFeedPath = resolveFeedPath(selectedFeedPath || defaultFeedPath);
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
    const fallbackGameDir = process.env.STFC_SIDECAR_DESKTOP === "1" ? "" : DEFAULT_GAME_DIR;
    const platformPath = normalizeWindowsPathForWsl(gameDir || fallbackGameDir);
    if (!platformPath) {
        return "";
    }

    return path.resolve(platformPath);
}

function resolveFeedPath(feedPath) {
    if (!feedPath) {
        return "";
    }

    const platformPath = normalizeWindowsPathForWsl(feedPath);
    return path.resolve(platformPath);
}

function resolveSettingsPath(selectedSettingsPath, selectedFeedPath) {
    if (!selectedSettingsPath && !selectedFeedPath) {
        return "";
    }

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
        if (!developerMode && events.some(isDeveloperEvent)) {
            return sendJson(response, 403, {
                ...developerModeRequiredPayload(),
                error: "Developer mode is required to ingest runtime diagnostic events.",
            });
        }

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

async function handleFleetSyncIngest(request, response) {
    if (!isAuthorizedSyncRequest(request)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized sidecar sync request" });
    }

    try {
        const payload = await readJsonBody(request);
        return sendJson(response, 202, cloudTelemetryBridge.ingestSyncPayload(payload));
    } catch (error) {
        return sendJson(response, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

async function handleMajelIngest(request, response) {
    if (!isAuthorizedSyncRequest(request)) {
        return sendJson(response, 401, { ok: false, error: "Unauthorized Majel sync request" });
    }

    try {
        const payload = await readJsonBody(request);
        const result = majelIngestStore.ingest(payload);
        if (!result.ok) {
            broadcastMajelUpdate("majel-rejected", { rejected: 1, error: result.error });
            return sendJson(response, 400, result);
        }

        broadcastEventUpdate("majel-ingest", { accepted: result.accepted });
        broadcastMajelUpdate("majel-ingest", { accepted: result.accepted });
        return sendJson(response, 202, result);
    } catch (error) {
        const result = majelIngestStore.recordRejected(error instanceof Error ? error.message : String(error));
        broadcastMajelUpdate("majel-rejected", { rejected: 1, error: result.error });
        return sendJson(response, 400, result);
    }
}

function readMajelSnapshot(limit) {
    return majelIngestStore.snapshot(limit);
}

function readMajelDetail(localId) {
    const detail = majelIngestStore.detail(localId);
    if (detail) {
        return detail;
    }

    return {
        ok: false,
        source: "majel-ingest-memory",
        statusCode: 404,
        error: "Majel envelope not available in the recent ingest window",
    };
}

function handleEventStream(request, response) {
    handleStream(request, response, eventStreamClients, "ready");
}

function handleMajelStream(request, response) {
    handleStream(request, response, majelStreamClients, "ready");
}

function handleStream(request, response, clients, readyReason) {
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
    clients.add(client);
    sendEventStreamMessage(client, "ready", streamPayload(readyReason));

    request.on("close", () => {
        clearInterval(client.keepalive);
        clients.delete(client);
    });
}

function broadcastEventUpdate(reason, extra = {}) {
    broadcastStreamUpdate(eventStreamClients, "events-updated", reason, extra);
}

function broadcastMajelUpdate(reason, extra = {}) {
    broadcastStreamUpdate(majelStreamClients, "majel-updated", reason, extra);
}

function broadcastStreamUpdate(clients, eventName, reason, extra = {}) {
    if (clients.size === 0) {
        return;
    }

    const payload = streamPayload(reason, extra);
    for (const client of clients) {
        sendEventStreamMessage(client, eventName, payload);
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

    if (eventTypesAllowBattleFeed(options.eventTypes)) {
        return battleFeed.readFeedSnapshot(limit, options);
    }

    return emptyEventsSnapshot(options);
}

async function readEventDetail(lineNumber, options = {}) {
    const store = eventStore;
    const storeRevision = eventStoreRevision;
    if (store) {
        try {
            const detail = await readStoredEvent(store, storeRevision, lineNumber, options);
            if (detail) {
                return detail;
            }

            return {
                ok: false,
                source: "store",
                storageBackend: store.backend,
                exists: true,
                statusCode: 404,
                error: "Event not available in the local event store",
            };
        } catch (error) {
            console.warn(`[sidecar-viewer] stored event detail unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if (eventTypesAllowBattleFeed(options.eventTypes)) {
        return battleFeed.readFeedLine(lineNumber);
    }

    return {
        ok: false,
        source: "store",
        statusCode: 404,
        error: "Event not available in this scope",
    };
}

async function readStoredSnapshot(store, storeRevision, limit, options = {}) {
    if (!store) {
        return null;
    }

    const generatedAt = new Date().toISOString();
    const resolvedLimit = Math.min(Math.max(limit, 10), 500);
    const includeDetails = options.includeDetails !== false;
    const eventTypes = normalizeEventTypeFilter(options.eventTypes);
    const [totalLines, storedEvents] = eventTypes
        ? await Promise.all([
            store.countByTypes(eventTypes),
            store.listRecentByTypes(eventTypes, resolvedLimit),
        ])
        : await Promise.all([
            store.count(),
            store.listRecent(resolvedLimit),
        ]);

    if (store !== eventStore || storeRevision !== eventStoreRevision) {
        return null;
    }

    if (storedEvents.length === 0) {
        return {
            ok: true,
            source: "store",
            storageBackend: store.backend,
            exists: true,
            detail: includeDetails ? "full" : "summary",
            generatedAt,
            pollHintMs: POLL_HINT_MS,
            totalLines,
            returnedLines: 0,
            events: [],
        };
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

async function readStoredEvent(store, storeRevision, lineNumber, options = {}) {
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

    const eventTypes = normalizeEventTypeFilter(options.eventTypes);
    if (eventTypes && !eventTypes.includes(storedEvent.event.type)) {
        return {
            ok: false,
            source: "store",
            storageBackend: store.backend,
            exists: true,
            statusCode: 404,
            error: "Event not available in this scope",
        };
    }

    const totalLines = eventTypes ? await store.countByTypes(eventTypes) : await store.count();
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

function emptyEventsSnapshot(options = {}) {
    return {
        ok: true,
        source: "store",
        exists: false,
        detail: options.includeDetails === false ? "summary" : "full",
        generatedAt: new Date().toISOString(),
        pollHintMs: POLL_HINT_MS,
        totalLines: 0,
        returnedLines: 0,
        events: [],
    };
}

function normalizeEventTypeFilter(eventTypes) {
    if (!Array.isArray(eventTypes)) {
        return null;
    }

    const normalized = [...new Set(eventTypes.map((eventType) => String(eventType).trim()).filter(Boolean))];
    return normalized.length > 0 ? normalized : null;
}

function eventTypesAllowBattleFeed(eventTypes) {
    const normalized = normalizeEventTypeFilter(eventTypes);
    if (!normalized) {
        return true;
    }

    return normalized.some((eventType) => eventType.startsWith("battle.") || eventType === "catalog.snapshot");
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

function isDeveloperEvent(event) {
    return DEVELOPER_EVENT_TYPES.has(event.type);
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
        source: event.source ?? null,
        level: event.level ?? null,
        sessionId: event.sessionId ?? null,
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

function isAuthorizedShutdownRequest(request) {
    return isShutdownRequestAuthorized(request, shutdownToken);
}

async function shutdownServer(reason) {
    if (shutdownRequested) {
        return;
    }

    shutdownRequested = true;
    battleFeed.close();
    for (const client of eventStreamClients) {
        clearInterval(client.keepalive);
        client.response.end();
    }
    eventStreamClients.clear();
    for (const client of majelStreamClients) {
        clearInterval(client.keepalive);
        client.response.end();
    }
    majelStreamClients.clear();
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
