import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_FEED_PATH = "C:\\Games\\Star Trek Fleet Command\\default\\game\\community_patch_battle_feed.jsonl";
const DEFAULT_PORT = 43127;
const DEFAULT_LIMIT = 150;
const DEFAULT_LOG_LINES = 80;
const READY_TIMEOUT_MS = 15000;
const STOP_TIMEOUT_MS = 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".sidecar");
const statePath = path.join(runtimeDir, "viewer-server.json");
const logPath = path.join(runtimeDir, "viewer-server.log");
const serverScriptPath = path.join(repoRoot, "packages", "viewer", "server.mjs");
await main();

async function main() {
    const [command = "start", ...commandArgs] = process.argv.slice(2);

    try {
        switch (command) {
            case "start":
                await startServer(commandArgs);
                return;
            case "stop":
                await stopServer();
                return;
            case "kill":
                await killServer();
                return;
            case "status":
                await showStatus(commandArgs);
                return;
            case "restart":
                await restartServer(commandArgs);
                return;
            case "logs":
                await showLogs(commandArgs);
                return;
            case "help":
            case "--help":
            case "-h":
                printUsage();
                return;
            default:
                throw new Error(`unknown command: ${command}`);
        }
    } catch (error) {
        console.error(`[sidecar-control] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

async function startServer(commandArgs) {
    const existingState = await loadManagedState({ cleanupStale: true });
    if (existingState) {
        throw new Error(`viewer server already running on ${existingState.url} (pid ${existingState.pid})`);
    }

    const serverConfig = resolveServerConfig(commandArgs);
    const unmanagedHealth = await fetchViewerHealth(serverConfig.port, 800);
    if (unmanagedHealth?.ok) {
        throw new Error(`viewer server already responds on port ${serverConfig.port} (pid ${unmanagedHealth.pid ?? "unknown"})`);
    }

    runCoreBuild();
    await ensureRuntimeDir();

    const shutdownToken = randomUUID();
    const syncToken = process.env.STFC_SIDECAR_SYNC_TOKEN?.trim() || randomUUID();
    await writeFile(logPath, `\n[${new Date().toISOString()}] [sidecar-control] starting viewer server\n`, { flag: "a" });

    const logFd = openSync(logPath, "a");
    const child = spawn(process.execPath, [serverScriptPath, ...serverConfig.launchArgs], {
        cwd: repoRoot,
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: {
            ...process.env,
            STFC_SIDECAR_SHUTDOWN_TOKEN: shutdownToken,
            STFC_SIDECAR_SYNC_TOKEN: syncToken,
        },
    });
    closeSync(logFd);

    if (!child.pid) {
        throw new Error("failed to start viewer server process");
    }

    child.unref();

    const state = {
        pid: child.pid,
        url: serverUrl(serverConfig.port),
        port: serverConfig.port,
        feedPath: serverConfig.feedPath,
        settingsPath: serverConfig.settingsPath,
        limit: serverConfig.limit,
        launchArgs: serverConfig.launchArgs,
        shutdownToken,
        startedAt: new Date().toISOString(),
        logPath,
    };

    await writeState(state);

    try {
        const health = await waitForServerReady(state, READY_TIMEOUT_MS);
        console.log(`[sidecar-control] viewer started at ${state.url}`);
        console.log(`[sidecar-control] pid ${state.pid} | log ${state.logPath}`);
        console.log(`[sidecar-control] feed ${health.feedPath ?? state.feedPath}`);
    } catch (error) {
        if (isProcessAlive(state.pid)) {
            await forceKillProcess(state.pid);
            await waitForExit(state.pid, 2000).catch(() => undefined);
        }
        await clearState();
        throw new Error(`${error instanceof Error ? error.message : String(error)}. Inspect ${logPath}`);
    }
}

async function stopServer() {
    const state = await loadManagedState({ cleanupStale: true });
    if (!state) {
        console.log("[sidecar-control] no managed viewer server is running");
        return;
    }

    const stopResponse = await requestGracefulShutdown(state);
    if (!stopResponse.ok) {
        throw new Error(stopResponse.error);
    }

    await waitForExit(state.pid, STOP_TIMEOUT_MS);
    await clearState();
    console.log(`[sidecar-control] viewer stopped (pid ${state.pid})`);
}

async function killServer() {
    const state = await loadManagedState({ cleanupStale: true });
    if (!state) {
        console.log("[sidecar-control] no managed viewer server is running");
        return;
    }

    await forceKillProcess(state.pid);
    await waitForExit(state.pid, 4000);
    await clearState();
    console.log(`[sidecar-control] viewer killed (pid ${state.pid})`);
}

async function restartServer(commandArgs) {
    const rememberedState = await readState();
    const launchArgs = commandArgs.length > 0 ? commandArgs : rememberedState?.launchArgs ?? [];

    const liveState = await loadManagedState({ cleanupStale: true });
    if (liveState) {
        const stopResponse = await requestGracefulShutdown(liveState);
        if (!stopResponse.ok) {
            throw new Error(stopResponse.error);
        }
        await waitForExit(liveState.pid, STOP_TIMEOUT_MS);
        await clearState();
        console.log(`[sidecar-control] viewer stopped for restart (pid ${liveState.pid})`);
    }

    await startServer(launchArgs);
}

async function showStatus(commandArgs) {
    const managedState = await readState();
    if (managedState && isProcessAlive(managedState.pid)) {
        const health = await fetchViewerHealth(managedState.port, 1000);
        console.log("[sidecar-control] managed viewer status: running");
        console.log(`pid: ${managedState.pid}`);
        console.log(`url: ${managedState.url}`);
        console.log(`port: ${managedState.port}`);
        console.log(`feed: ${managedState.feedPath}`);
        console.log(`settings: ${managedState.settingsPath ?? "default beside feed"}`);
        console.log(`limit: ${managedState.limit}`);
        console.log(`started: ${managedState.startedAt}`);
        console.log(`health: ${health?.ok ? "ok" : "unreachable"}`);
        console.log(`log: ${managedState.logPath}`);
        return;
    }

    if (managedState) {
        await clearState();
        console.log(`[sidecar-control] removed stale viewer state for pid ${managedState.pid ?? "unknown"}`);
    }

    const requestedPort = resolveStatusPort(commandArgs);
    const health = await fetchViewerHealth(requestedPort, 800);
    if (health?.ok) {
        console.log("[sidecar-control] unmanaged viewer detected");
        console.log(`pid: ${health.pid ?? "unknown"}`);
        console.log(`url: ${serverUrl(requestedPort)}`);
        console.log(`feed: ${health.feedPath ?? "unknown"}`);
        console.log(`settings: ${health.settingsPath ?? "unknown"}`);
        return;
    }

    console.log("[sidecar-control] viewer status: stopped");
}

async function showLogs(commandArgs) {
    const lineCount = resolveLogLines(commandArgs);
    if (!existsSync(logPath)) {
        console.log(`[sidecar-control] no viewer log file at ${logPath}`);
        return;
    }

    const contents = await readFile(logPath, "utf8");
    const lines = contents.split(/\r?\n/);
    const tail = lines.slice(-lineCount).join("\n").trim();

    if (!tail) {
        console.log(`[sidecar-control] viewer log is empty: ${logPath}`);
        return;
    }

    console.log(tail);
}

function printUsage() {
    console.log("Usage: node scripts/viewer-server-control.mjs <start|stop|kill|status|restart|logs> [viewer args]");
    console.log("Viewer args: --feed-path <jsonl> --settings-path <toml> --port <number> --limit <number>");
    console.log("Log args: logs [--lines <count>]");
}

function runCoreBuild() {
    const npmInvocation = resolveNpmInvocation(["run", "build", "--workspace", "@stfc-mod-sidecar/core"]);
    const result = spawnSync(npmInvocation.command, npmInvocation.args, {
        cwd: repoRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (result.error) {
        throw new Error(`sidecar core build failed: ${result.error.message}`);
    }

    if (result.status !== 0) {
        throw new Error(`sidecar core build failed with exit code ${result.status ?? "unknown"}`);
    }
}

function resolveNpmInvocation(args) {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath) {
        return {
            command: process.execPath,
            args: [npmExecPath, ...args],
        };
    }

    return {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        args,
    };
}

function resolveServerConfig(commandArgs) {
    let selectedFeedPath = process.env.STFC_SIDECAR_FEED_PATH ?? DEFAULT_FEED_PATH;
    let selectedSettingsPath = process.env.STFC_SIDECAR_SETTINGS_PATH ?? "";
    let selectedPort = parseInteger(process.env.STFC_SIDECAR_PORT, DEFAULT_PORT);
    let selectedLimit = parseInteger(process.env.STFC_SIDECAR_LIMIT, DEFAULT_LIMIT);

    for (let index = 0; index < commandArgs.length; index += 1) {
        const arg = commandArgs[index];
        const value = commandArgs[index + 1];

        if ((arg === "--feed-path" || arg === "--settings-path" || arg === "--port" || arg === "--limit") && value === undefined) {
            throw new Error(`missing value for ${arg}`);
        }

        if (arg === "--feed-path") {
            selectedFeedPath = value;
            index += 1;
            continue;
        }

        if (arg === "--settings-path") {
            selectedSettingsPath = value;
            index += 1;
            continue;
        }

        if (arg === "--port") {
            selectedPort = parseInteger(value, DEFAULT_PORT);
            index += 1;
            continue;
        }

        if (arg === "--limit") {
            selectedLimit = parseInteger(value, DEFAULT_LIMIT);
            index += 1;
        }
    }

    const resolvedFeedPath = resolveFeedPath(selectedFeedPath, repoRoot);
    return {
        launchArgs: [...commandArgs],
        port: selectedPort,
        limit: selectedLimit,
        feedPath: resolvedFeedPath,
        settingsPath: selectedSettingsPath ? resolveFeedPath(selectedSettingsPath, repoRoot) : path.join(path.dirname(resolvedFeedPath), "community_patch_settings.toml"),
    };
}

function resolveFeedPath(feedPath, baseDir) {
    const platformPath = normalizeWindowsPathForWsl(feedPath);
    return path.isAbsolute(platformPath) ? platformPath : path.resolve(baseDir, platformPath);
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

function resolveStatusPort(commandArgs) {
    for (let index = 0; index < commandArgs.length; index += 1) {
        if (commandArgs[index] === "--port") {
            return parseInteger(commandArgs[index + 1], DEFAULT_PORT);
        }
    }

    return parseInteger(process.env.STFC_SIDECAR_PORT, DEFAULT_PORT);
}

function resolveLogLines(commandArgs) {
    for (let index = 0; index < commandArgs.length; index += 1) {
        if (commandArgs[index] === "--lines") {
            return parseInteger(commandArgs[index + 1], DEFAULT_LOG_LINES);
        }
    }

    return DEFAULT_LOG_LINES;
}

async function loadManagedState({ cleanupStale } = { cleanupStale: false }) {
    const state = await readState();
    if (!state) {
        return null;
    }

    if (isProcessAlive(state.pid)) {
        return state;
    }

    if (cleanupStale) {
        await clearState();
        console.log(`[sidecar-control] removed stale viewer state for pid ${state.pid ?? "unknown"}`);
    }

    return null;
}

async function readState() {
    if (!existsSync(statePath)) {
        return null;
    }

    try {
        return JSON.parse(await readFile(statePath, "utf8"));
    } catch {
        await clearState();
        return null;
    }
}

async function writeState(state) {
    await ensureRuntimeDir();
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function clearState() {
    await rm(statePath, { force: true });
}

async function ensureRuntimeDir() {
    await mkdir(runtimeDir, { recursive: true });
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForServerReady(state, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const health = await fetchViewerHealth(state.port, 1000);
        if (health?.ok && health.pid === state.pid) {
            return health;
        }

        if (!isProcessAlive(state.pid)) {
            break;
        }

        await delay(250);
    }

    throw new Error(`viewer server did not become ready on ${state.url}`);
}

async function requestGracefulShutdown(state) {
    if (!isProcessAlive(state.pid)) {
        await clearState();
        return { ok: true };
    }

    try {
        const response = await fetch(`${state.url}/api/admin/shutdown`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${state.shutdownToken}`,
            },
        });

        if (!response.ok) {
            const body = await response.text();
            return { ok: false, error: `viewer rejected shutdown (${response.status}): ${body}` };
        }

        return { ok: true };
    } catch (error) {
        if (!isProcessAlive(state.pid)) {
            await clearState();
            return { ok: true };
        }

        return {
            ok: false,
            error: `viewer graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

async function forceKillProcess(pid) {
    if (!isProcessAlive(pid)) {
        return;
    }

    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", `${pid}`, "/T", "/F"], { stdio: "ignore" });
        if (!isProcessAlive(pid)) {
            return;
        }
        throw new Error(`failed to kill viewer process ${pid}`);
    }

    process.kill(pid, "SIGKILL");
}

async function waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) {
            return;
        }

        await delay(200);
    }

    throw new Error(`viewer process ${pid} did not exit within ${timeoutMs}ms`);
}

async function fetchViewerHealth(port, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();

    try {
        const response = await fetch(`${serverUrl(port)}/api/health`, {
            signal: controller.signal,
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

function serverUrl(port) {
    return `http://127.0.0.1:${port}`;
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
