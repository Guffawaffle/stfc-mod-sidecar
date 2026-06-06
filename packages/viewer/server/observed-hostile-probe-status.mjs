import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import { parse as parseToml } from "smol-toml";

const SETTINGS_FILE = "community_patch_settings.toml";
const RUNTIME_VARS_FILE = "community_patch_runtime.vars";

export async function readObservedHostileProbeStatus(options = {}) {
    const gameDir = asText(options.gameDir);
    const settingsPath = asText(options.settingsPath) || (gameDir ? path.join(gameDir, SETTINGS_FILE) : "");
    const runtimeVarsPath = gameDir ? path.join(gameDir, RUNTIME_VARS_FILE) : "";
    const detectGameProcess = typeof options.detectStfcGameProcess === "function"
        ? options.detectStfcGameProcess
        : null;

    const [settings, runtime, gameProcess] = await Promise.all([
        readTomlSnapshot(settingsPath),
        readTomlSnapshot(runtimeVarsPath),
        detectGameProcess && gameDir
            ? detectGameProcess({ gameDirectory: gameDir }).catch((error) => ({
                checked: false,
                running: false,
                error: error instanceof Error ? error.message : String(error),
            }))
            : Promise.resolve({ checked: false, running: false }),
    ]);

    return buildObservedHostileProbeStatus({
        settingsPath,
        runtimeVarsPath,
        settings,
        runtime,
        gameProcess,
    });
}

export function buildObservedHostileProbeStatus(input = {}) {
    const settings = normalizeSnapshot(input.settings);
    const runtime = normalizeSnapshot(input.runtime);
    const gameProcess = normalizeGameProcess(input.gameProcess);
    const settingsConfig = evaluateProbeConfig(settings.root, { resolvedSnapshot: false });
    const runtimeConfig = evaluateProbeConfig(runtime.root, { resolvedSnapshot: true });
    const settingsChangedAfterRuntime = settings.updatedAtUnixMs != null
        && runtime.updatedAtUnixMs != null
        && settings.updatedAtUnixMs > runtime.updatedAtUnixMs;

    const result = {
        ok: true,
        settingsPath: asText(input.settingsPath),
        runtimeVarsPath: asText(input.runtimeVarsPath),
        gameProcess,
        settings: {
            exists: settings.exists,
            parseError: settings.parseError || null,
            updatedAt: settings.updatedAt,
            updatedAtUnixMs: settings.updatedAtUnixMs,
            ...settingsConfig,
        },
        runtime: {
            exists: runtime.exists,
            parseError: runtime.parseError || null,
            updatedAt: runtime.updatedAt,
            updatedAtUnixMs: runtime.updatedAtUnixMs,
            ...runtimeConfig,
        },
        settingsChangedAfterRuntime,
        status: "capture_ready",
        summary: "Observed hostile capture is active in the live runtime.",
        details: [],
    };

    if (!settings.exists) {
        return withStatus(result, "settings_unavailable",
            "Community Mod settings are unavailable for the selected STFC directory.",
            [
                "Select a valid STFC game directory before using observed hostile capture.",
            ]);
    }

    if (settings.parseError) {
        return withStatus(result, "settings_invalid",
            "community_patch_settings.toml is invalid, so the mod will fall back to defaults and hostile observation will stay off.",
            [
                `Settings parse error: ${settings.parseError}`,
            ]);
    }

    if (!settingsConfig.hostileObservationEnabled) {
        return withStatus(result, "disabled_in_settings",
            "Observed hostile capture is off in community_patch_settings.toml.",
            [
                "Set [advanced.diagnostics].hostile_observation = true to enable the sidecar-local probe.",
            ]);
    }

    if (!settingsConfig.objectTrackerEnabled) {
        return withStatus(result, "object_tracker_disabled",
            "Observed hostile capture cannot run because patches.objecttracker is disabled in community_patch_settings.toml.",
            [
                "Enable patches.objecttracker so the hostile observation probe can inspect loaded entities.",
            ]);
    }

    if (!settingsConfig.transportReady) {
        return withStatus(result, "transport_not_configured",
            "Observed hostile capture is enabled, but [sidecar.sync] is not ready for local ingest.",
            buildTransportDetails(settingsConfig, "Settings"));
    }

    if (runtime.parseError) {
        return withStatus(result, "runtime_invalid",
            "community_patch_runtime.vars could not be read. Restart STFC so the mod can regenerate its live runtime snapshot.",
            [
                `Runtime vars parse error: ${runtime.parseError}`,
            ]);
    }

    if (!runtime.exists) {
        return withStatus(
            result,
            gameProcess.running ? "runtime_unavailable" : "launch_required",
            gameProcess.running
                ? "The game appears to be running, but no live Community Mod runtime snapshot is available yet."
                : "Observed hostile capture is configured. Launch or relaunch STFC so the mod can load the probe.",
            [
                "community_patch_runtime.vars is missing, so the sidecar cannot confirm the live probe state.",
            ],
        );
    }

    if (runtimeConfig.effectiveCaptureEnabled) {
        return withStatus(result, "capture_ready",
            "Observed hostile capture is active in the live runtime.",
            [
                "The probe is enabled in runtime vars and sidecar local ingest is configured.",
            ]);
    }

    if (gameProcess.running || settingsChangedAfterRuntime) {
        const details = [
            "community_patch_settings.toml enables hostile observation, but the live runtime snapshot still does not.",
            ...runtimeMismatchDetails(runtimeConfig, settingsChangedAfterRuntime),
        ];
        return withStatus(result, "restart_required",
            "Observed hostile capture is enabled in settings, but the running mod has not applied it yet. Restart STFC to load the probe.",
            details);
    }

    return withStatus(result, "launch_required",
        "Observed hostile capture is configured, but the current runtime snapshot does not have it active. Launch or relaunch STFC to apply the setting.",
        runtimeMismatchDetails(runtimeConfig, settingsChangedAfterRuntime));
}

async function readTomlSnapshot(filePath) {
    const resolvedPath = asText(filePath);
    if (!resolvedPath) {
        return normalizeSnapshot();
    }

    try {
        const [fileStat, text] = await Promise.all([
            stat(resolvedPath),
            readFile(resolvedPath, "utf8"),
        ]);
        return normalizeSnapshot({
            exists: true,
            path: resolvedPath,
            text,
            updatedAt: fileStat.mtime.toISOString(),
            updatedAtUnixMs: fileStat.mtimeMs,
            root: parseTomlSafe(text),
        });
    } catch (error) {
        if (isMissingError(error)) {
            return normalizeSnapshot({
                exists: false,
                path: resolvedPath,
            });
        }

        return normalizeSnapshot({
            exists: true,
            path: resolvedPath,
            parseError: error instanceof Error ? error.message : String(error),
        });
    }
}

function normalizeSnapshot(snapshot = {}) {
    return {
        exists: snapshot.exists === true,
        path: asText(snapshot.path),
        parseError: asText(snapshot.parseError),
        updatedAt: asText(snapshot.updatedAt) || null,
        updatedAtUnixMs: Number.isFinite(snapshot.updatedAtUnixMs) ? Number(snapshot.updatedAtUnixMs) : null,
        root: asRecord(snapshot.root),
    };
}

function normalizeGameProcess(gameProcess = {}) {
    return {
        checked: gameProcess?.checked === true,
        running: gameProcess?.running === true,
        error: asText(gameProcess?.error) || null,
    };
}

function parseTomlSafe(text) {
    const normalized = typeof text === "string" ? text.trim() : "";
    if (!normalized) {
        return {};
    }

    return asRecord(parseToml(normalized));
}

function evaluateProbeConfig(root, options = {}) {
    const resolvedSnapshot = options.resolvedSnapshot === true;
    const hostileObservationEnabled = readBoolean(root, ["advanced", "diagnostics", "hostile_observation"], false);
    const objectTrackerEnabled = readBoolean(root, ["patches", "objecttracker"], true);
    const sidecarSyncEnabled = readBoolean(root, ["sidecar", "sync", "enabled"], false);
    const sidecarSyncUrl = readString(root, ["sidecar", "sync", "url"]);
    const sidecarSyncToken = readString(root, ["sidecar", "sync", "token"]);
    const sidecarSyncUrlPresent = sidecarSyncUrl.length > 0;
    const sidecarSyncTokenPresent = sidecarSyncToken.length > 0;
    const transportReady = sidecarSyncEnabled && sidecarSyncUrlPresent && sidecarSyncTokenPresent;

    return {
        resolvedSnapshot,
        hostileObservationEnabled,
        objectTrackerEnabled,
        sidecarSyncEnabled,
        sidecarSyncUrlPresent,
        sidecarSyncTokenPresent,
        transportReady,
        effectiveCaptureEnabled: hostileObservationEnabled && objectTrackerEnabled && transportReady,
    };
}

function runtimeMismatchDetails(runtimeConfig, settingsChangedAfterRuntime) {
    const details = [];
    if (!runtimeConfig.hostileObservationEnabled) {
        details.push("Runtime vars still show hostile_observation=false.");
    }
    if (!runtimeConfig.objectTrackerEnabled) {
        details.push("Runtime vars show patches.objecttracker=false.");
    }
    if (!runtimeConfig.transportReady) {
        details.push(...buildTransportDetails(runtimeConfig, "Runtime vars"));
    }
    if (settingsChangedAfterRuntime) {
        details.push("community_patch_settings.toml is newer than community_patch_runtime.vars.");
    }
    return details;
}

function buildTransportDetails(config, label) {
    const details = [];
    if (!config.sidecarSyncEnabled) {
        details.push(`${label} show sidecar.sync.enabled=false.`);
    }
    if (!config.sidecarSyncUrlPresent) {
        details.push(`${label} do not include sidecar.sync.url.`);
    }
    if (!config.sidecarSyncTokenPresent) {
        details.push(`${label} do not include sidecar.sync.token.`);
    }
    return details;
}

function withStatus(result, status, summary, details = []) {
    return {
        ...result,
        status,
        summary,
        details: details.filter((detail) => asText(detail).length > 0),
    };
}

function readBoolean(root, pathSegments, fallback) {
    const value = readPath(root, pathSegments);
    return typeof value === "boolean" ? value : fallback;
}

function readString(root, pathSegments) {
    const value = readPath(root, pathSegments);
    return typeof value === "string" ? value.trim() : "";
}

function readPath(root, pathSegments) {
    let current = root;
    for (const segment of pathSegments) {
        if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, segment)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}

function isMissingError(error) {
    return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function asRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function asText(value) {
    return typeof value === "string" ? value.trim() : "";
}
