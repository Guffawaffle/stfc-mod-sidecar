import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SIDECAR_PORT = 43127;

const READY_TIMEOUT_MS = 15000;
const SHUTDOWN_TIMEOUT_MS = 5000;

export function createSidecarServerProcess(options) {
    let sidecarProcess = null;
    let sidecarShutdownToken = "";
    let sidecarSyncToken = "";
    let sidecarModToken = "";
    let sidecarUrl = "";

    return {
        get url() {
            return sidecarUrl;
        },
        get modToken() {
            return sidecarModToken;
        },
        isRunning() {
            return Boolean(sidecarProcess);
        },
        shouldStopOnQuit() {
            return Boolean(sidecarProcess && sidecarShutdownToken && sidecarUrl);
        },
        defaultUrl() {
            const port = requestedSidecarPort(options.env ?? options.process?.env ?? process.env);
            return `http://127.0.0.1:${port}`;
        },
        fetchHealth(url, timeoutMs) {
            return fetchHealth(url, timeoutMs);
        },
        async ensureSidecarServer() {
            const env = options.env ?? options.process?.env ?? process.env;
            const requestedPort = Number.parseInt(env.STFC_SIDECAR_PORT ?? String(DEFAULT_SIDECAR_PORT), 10);
            const firstPort = Number.isFinite(requestedPort) ? requestedPort : DEFAULT_SIDECAR_PORT;

            for (let offset = 0; offset < 10; offset += 1) {
                const port = firstPort + offset;
                const url = `http://127.0.0.1:${port}`;
                const existing = await fetchReadiness(url, 800);
                if (!existing?.ok) {
                    const server = await startSidecarServer(url);
                    sidecarUrl = server.url;
                    return server;
                }

                if (existing.desktop === true) {
                    options.writeLog("log", `[sidecar-desktop] using existing desktop sidecar server at ${url}`);
                    sidecarUrl = url;
                    return { url, owned: false };
                }

                options.writeLog("warn", `[sidecar-desktop] port ${port} already has a browser-mode sidecar server; trying next port`);
            }

            throw new Error(`No available sidecar port near ${firstPort}; stop browser-mode viewer servers or set STFC_SIDECAR_PORT.`);
        },
        async startSidecarServer(url) {
            const server = await startSidecarServer(url);
            sidecarUrl = server.url;
            return server;
        },
        async stopSidecarServer() {
            const processToStop = sidecarProcess;
            if (!processToStop || !sidecarUrl || !sidecarShutdownToken) {
                return;
            }

            try {
                await fetch(`${sidecarUrl}/api/admin/shutdown`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${sidecarShutdownToken}`,
                    },
                });
                await waitForExit(processToStop, SHUTDOWN_TIMEOUT_MS);
            } catch (error) {
                options.writeLog("warn", `[sidecar-desktop] graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
                processToStop.kill();
            } finally {
                sidecarProcess = null;
                sidecarShutdownToken = "";
                sidecarSyncToken = "";
            }
        },
    };

    async function startSidecarServer(url) {
        const runtimeProcess = options.process ?? process;
        const runtimeEnv = options.env ?? runtimeProcess.env;
        const paths = resolveRuntimePaths({
            app: options.app,
            dirname: options.dirname,
            process: runtimeProcess,
        });
        const gameDirectory = await options.getGameDirectoryForStartup();
        const userDataPath = options.app.getPath("userData");
        sidecarShutdownToken = randomUUID();
        sidecarSyncToken = runtimeEnv.STFC_SIDECAR_SYNC_TOKEN?.trim() || randomUUID();
        sidecarModToken = runtimeEnv.STFC_SIDECAR_MOD_TOKEN?.trim() || randomUUID();
        options.writeLog(
            "log",
            `[sidecar-desktop] starting server cwd=${paths.cwd} serverScript=${paths.serverScript} gameDirectory=${gameDirectory || "default"} mode=${options.getCompanionMode()} serverExists=${fs.existsSync(paths.serverScript)}`,
        );

        const args = [paths.serverScript, "--port", new URL(url).port];
        if (gameDirectory) {
            args.push("--game-dir", gameDirectory);
        }

        const desktopSettings = options.getDesktopSettings();
        sidecarProcess = spawn(runtimeProcess.execPath, args, {
            cwd: paths.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: {
                ...runtimeEnv,
                ELECTRON_RUN_AS_NODE: "1",
                STFC_SIDECAR_DESKTOP: "1",
                STFC_SIDECAR_DEVELOPER_MODE: desktopSettings.developerMode ? "1" : "0",
                STFC_SIDECAR_MOD_PROFILE: desktopSettings.modProfile,
                STFC_SIDECAR_CACHE_DIR: path.join(userDataPath, "cache"),
                STFC_SIDECAR_STORE_CONNECTION: runtimeEnv.STFC_SIDECAR_STORE_CONNECTION?.trim()
                    || path.join(userDataPath, "sidecar-events.sqlite"),
                ...releaseEnvironment(options.getReleaseInfo()),
                STFC_SIDECAR_SHUTDOWN_TOKEN: sidecarShutdownToken,
                STFC_SIDECAR_SYNC_TOKEN: sidecarSyncToken,
                STFC_SIDECAR_MOD_TOKEN: sidecarModToken,
                STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1",
                STFC_SIDECAR_ENABLE_MOD_UNINSTALL_EXECUTION: "1",
            },
        });

        sidecarProcess.stdout?.on("data", (chunk) => options.writeLog("log", `[sidecar-server] ${chunk.toString().trimEnd()}`));
        sidecarProcess.stderr?.on("data", (chunk) => options.writeLog("error", `[sidecar-server] ${chunk.toString().trimEnd()}`));
        sidecarProcess.on("exit", (code, signal) => {
            options.writeLog("log", `[sidecar-desktop] sidecar server exited code=${code ?? "null"} signal=${signal ?? "null"}`);
            sidecarProcess = null;
        });

        await waitForHealth(url, READY_TIMEOUT_MS);
        options.writeLog("log", `[sidecar-desktop] started sidecar server at ${url}`);
        return { url, owned: true };
    }
}

function requestedSidecarPort(env = process.env) {
    const requestedPort = Number.parseInt(env.STFC_SIDECAR_PORT ?? String(DEFAULT_SIDECAR_PORT), 10);
    return Number.isFinite(requestedPort) ? requestedPort : DEFAULT_SIDECAR_PORT;
}

function resolveRuntimePaths(options) {
    if (options.app.isPackaged) {
        return {
            cwd: options.process.resourcesPath,
            serverScript: path.join(options.process.resourcesPath, "viewer", "server.mjs"),
        };
    }

    const repoRoot = path.resolve(options.dirname, "..", "..", "..");
    return {
        cwd: repoRoot,
        serverScript: path.join(repoRoot, "packages", "viewer", "server.mjs"),
    };
}

async function waitForHealth(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
        try {
            const health = await fetchReadiness(url, 800);
            if (health?.ok) {
                return health;
            }
        } catch (error) {
            lastError = error;
        }

        await delay(250);
    }

    throw new Error(`sidecar server did not become ready at ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

async function fetchHealth(url, timeoutMs) {
    return fetchJson(`${url}/api/health`, Math.max(timeoutMs, 2000));
}

async function fetchReadiness(url, timeoutMs) {
    return await fetchJson(`${url}/api/health/ready`, timeoutMs) ?? await fetchHealth(url, timeoutMs);
}

async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            return null;
        }

        return response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function waitForExit(child, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timed out waiting for sidecar server exit")), timeoutMs);
        child.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function releaseEnvironment(release) {
    return {
        STFC_SIDECAR_APP_VERSION: release.version,
        STFC_SIDECAR_RELEASE_CHANNEL: release.channel,
        STFC_SIDECAR_UPDATE_MODE: release.updateMode,
        STFC_SIDECAR_SIGNATURE_POLICY: release.signaturePolicy,
    };
}
