import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import electronPath from "electron";

const COMMANDS = new Set(["start", "start-bg", "run-managed", "status", "stop", "logs"]);
const DEFAULT_COMMAND = "start";
const DEFAULT_PORT = 43127;
const DEFAULT_LOG_LINES = 80;
const HEALTH_TIMEOUT_MS = 1500;
const STARTUP_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 10000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = __filename;
const repoRoot = path.resolve(__dirname, "..");
const runtimeDir = path.join(repoRoot, ".runtime");
const logsDir = path.join(repoRoot, ".logs");
const pidPath = path.join(runtimeDir, "desktop-dev.pid");
const statePath = path.join(runtimeDir, "desktop-dev.json");
const stdoutLogPath = path.join(logsDir, "desktop-dev.out.log");
const stderrLogPath = path.join(logsDir, "desktop-dev.err.log");
const desktopEntryPath = path.join(repoRoot, "packages", "desktop", "src", "main.mjs");

export function parseDesktopDevArgs(argv) {
    const parsed = {
        command: DEFAULT_COMMAND,
        skipStop: false,
        cycle: false,
        launchArgs: [],
        lines: DEFAULT_LOG_LINES,
    };
    let commandResolved = false;

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === "--skip-stop") {
            parsed.skipStop = true;
            continue;
        }

        if (arg === "--cycle") {
            parsed.cycle = true;
            continue;
        }

        if (!commandResolved && COMMANDS.has(arg)) {
            parsed.command = arg;
            commandResolved = true;
            continue;
        }

        if (arg === "--lines") {
            const value = argv[index + 1];
            if (value === undefined) {
                throw new Error("missing value for --lines");
            }

            parsed.lines = parseInteger(value, DEFAULT_LOG_LINES);
            index += 1;
            continue;
        }

        parsed.launchArgs.push(arg);
    }

    return parsed;
}

export async function runDesktopDev(argv = process.argv.slice(2)) {
    const args = parseDesktopDevArgs(argv);

    switch (args.command) {
        case "start":
            return startForeground(args);
        case "start-bg":
            return startBackground(args);
        case "run-managed":
            return runManaged(args);
        case "status":
            return showStatus();
        case "stop":
            return stopManagedDesktop();
        case "logs":
            return showLogs(args.lines);
        default:
            throw new Error(`unknown command: ${args.command}`);
    }
}

async function startForeground(args) {
    const managedState = loadManagedState({ cleanupStale: true });
    if (managedState) {
        throw new Error(`managed desktop dev is already running (pid ${managedState.pid}); stop it with npm run desktop:dev:stop first`);
    }

    return launchElectron(args, { managed: false });
}

async function startBackground(args) {
    const managedState = loadManagedState({ cleanupStale: true });
    if (managedState && args.cycle) {
        await stopManagedDesktop();
    } else if (managedState) {
        throw new Error(`managed desktop dev is already running (pid ${managedState.pid})`);
    }

    prepareDesktopLaunch(args.skipStop);
    ensureManagedDirs();

    const stdoutFd = openSync(stdoutLogPath, "a");
    const stderrFd = openSync(stderrLogPath, "a");
    let child;

    try {
        const managerArgs = [scriptPath, "run-managed", ...args.launchArgs];
        if (args.skipStop) {
            managerArgs.push("--skip-stop");
        }

        child = spawn(process.execPath, managerArgs, {
            cwd: repoRoot,
            env: process.env,
            detached: true,
            stdio: ["ignore", stdoutFd, stderrFd],
            shell: false,
            windowsHide: true,
        });
    } finally {
        closeSync(stdoutFd);
        closeSync(stderrFd);
    }

    if (!child?.pid) {
        throw new Error("failed to start managed desktop dev process");
    }

    child.unref();

    const state = {
        pid: child.pid,
        role: "manager",
        port: resolveSidecarPort(),
        healthUrl: healthUrlForPort(resolveSidecarPort()),
        pidPath,
        statePath,
        stdoutLogPath,
        stderrLogPath,
        launchArgs: args.launchArgs,
        startedAt: new Date().toISOString(),
    };
    writeManagedState(state);

    const startup = await waitForManagedStartup(state, STARTUP_TIMEOUT_MS);
    if (startup.state === "exited") {
        clearManagedState();
        throw new Error(`managed desktop dev exited during startup. Inspect ${stdoutLogPath} and ${stderrLogPath}`);
    }

    console.log(`[desktop-dev] started background desktop dev (pid ${state.pid})`);
    console.log(`[desktop-dev] state ${state.statePath}`);
    console.log(`[desktop-dev] logs ${state.stdoutLogPath} | ${state.stderrLogPath}`);

    if (startup.state === "healthy") {
        console.log(`[desktop-dev] health ok at ${state.healthUrl}`);
    } else {
        console.log(`[desktop-dev] process is running; health not ready yet at ${state.healthUrl}`);
    }

    return 0;
}

async function runManaged(args) {
    return launchElectron(args, { managed: true });
}

async function showStatus() {
    const managedState = readManagedState();
    if (managedState) {
        if (!isProcessAlive(managedState.pid)) {
            clearManagedState();
            console.log("state: stale");
            console.log(`pid: ${managedState.pid}`);
            console.log(`stateFile: ${statePath}`);
            return 0;
        }

        const health = await fetchHealth(managedState.healthUrl, HEALTH_TIMEOUT_MS);
        console.log(`state: ${health.ok ? "managed-healthy" : "managed-unavailable"}`);
        console.log(`pid: ${managedState.pid}`);
        console.log(`healthUrl: ${managedState.healthUrl}`);
        console.log(`startedAt: ${managedState.startedAt}`);
        console.log(`pidFile: ${managedState.pidPath}`);
        console.log(`stateFile: ${managedState.statePath}`);
        console.log(`stdoutLog: ${managedState.stdoutLogPath}`);
        console.log(`stderrLog: ${managedState.stderrLogPath}`);
        if (health.ok && health.payload) {
            console.log(`healthMode: ${health.payload.mode ?? "unknown"}`);
        }
        return 0;
    }

    const healthUrl = healthUrlForPort(resolveSidecarPort());
    const health = await fetchHealth(healthUrl, HEALTH_TIMEOUT_MS);
    if (health.ok) {
        console.log("state: unmanaged");
        console.log(`healthUrl: ${healthUrl}`);
        return 0;
    }

    console.log("state: unavailable");
    console.log(`healthUrl: ${healthUrl}`);
    return 0;
}

async function stopManagedDesktop() {
    const managedState = readManagedState();
    if (!managedState) {
        console.log("[desktop-dev] no managed desktop dev process is recorded");
        return 0;
    }

    if (!isProcessAlive(managedState.pid)) {
        clearManagedState();
        console.log(`[desktop-dev] removed stale desktop dev state for pid ${managedState.pid}`);
        return 0;
    }

    killProcessTree(managedState.pid);
    await waitForExit(managedState.pid, STOP_TIMEOUT_MS);
    clearManagedState();
    console.log(`[desktop-dev] stopped managed desktop dev (pid ${managedState.pid})`);
    return 0;
}

async function showLogs(lineCount) {
    const stdoutTail = await readLogTail(stdoutLogPath, lineCount);
    const stderrTail = await readLogTail(stderrLogPath, lineCount);

    if (!stdoutTail && !stderrTail) {
        console.log(`[desktop-dev] no managed desktop dev logs found at ${logsDir}`);
        return 0;
    }

    if (stdoutTail) {
        console.log(`== stdout (${stdoutLogPath}) ==`);
        console.log(stdoutTail);
    }

    if (stderrTail) {
        console.log(`== stderr (${stderrLogPath}) ==`);
        console.log(stderrTail);
    }

    return 0;
}

function prepareDesktopLaunch(skipStop) {
    const liveManagedState = loadManagedState({ cleanupStale: true });
    if (liveManagedState && process.pid !== liveManagedState.pid) {
        throw new Error(`managed desktop dev is already running (pid ${liveManagedState.pid})`);
    }

    if (!skipStop) {
        run(resolveNpmInvocation(["run", "server:stop"]), { allowFailure: false });
    }

    run(resolveNpmInvocation(["run", "build", "--workspace", "@stfc-mod-sidecar/core"]), { allowFailure: false });
}

function launchElectron(args, options = {}) {
    prepareDesktopLaunch(args.skipStop);
    const result = spawnSync(electronPath, [desktopEntryPath, ...args.launchArgs], {
        cwd: repoRoot,
        env: createElectronEnv(),
        stdio: "inherit",
        shell: false,
    });

    if (result.error) {
        throw result.error;
    }

    if (options.managed) {
        clearManagedState();
    }

    return result.status ?? 0;
}

function createElectronEnv() {
    const electronEnv = { ...process.env };
    delete electronEnv.ELECTRON_RUN_AS_NODE;
    return electronEnv;
}

function run(invocation, options) {
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: repoRoot,
        env: invocation.env ?? process.env,
        stdio: "inherit",
        shell: false,
    });

    if (result.error) {
        throw result.error;
    }

    if (!options.allowFailure && result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function ensureManagedDirs() {
    mkdirSync(runtimeDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
}

function writeManagedState(state) {
    ensureManagedDirs();
    writeFileSync(pidPath, `${state.pid}\n`, "utf8");
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readManagedState() {
    if (!existsSync(statePath)) {
        return null;
    }

    try {
        return JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
        clearManagedState();
        return null;
    }
}

function loadManagedState({ cleanupStale } = { cleanupStale: false }) {
    const state = readManagedState();
    if (!state) {
        return null;
    }

    if (isProcessAlive(state.pid)) {
        return state;
    }

    if (cleanupStale) {
        clearManagedState();
    }

    return null;
}

function clearManagedState() {
    rmSync(pidPath, { force: true });
    rmSync(statePath, { force: true });
}

async function waitForManagedStartup(state, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(state.pid)) {
            return { state: "exited" };
        }

        const health = await fetchHealth(state.healthUrl, HEALTH_TIMEOUT_MS);
        if (health.ok) {
            return { state: "healthy", health };
        }

        await delay(500);
    }

    return isProcessAlive(state.pid) ? { state: "running" } : { state: "exited" };
}

async function waitForExit(pid, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) {
            return;
        }

        await delay(250);
    }

    throw new Error(`timed out waiting for process ${pid} to exit`);
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

function killProcessTree(pid) {
    if (!pid) {
        return;
    }

    if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore" });
        return;
    }

    try {
        process.kill(-pid, "SIGTERM");
    } catch {
        try {
            process.kill(pid, "SIGTERM");
        } catch {
            // Already exited.
        }
    }
}

async function fetchHealth(healthUrl, timeoutMs) {
    try {
        const response = await fetch(healthUrl, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            return { ok: false, status: response.status };
        }

        const payload = await response.json();
        return { ok: true, status: response.status, payload };
    } catch {
        return { ok: false, status: null };
    }
}

async function readLogTail(filePath, lineCount) {
    if (!existsSync(filePath)) {
        return "";
    }

    const contents = await readFile(filePath, "utf8");
    return contents.split(/\r?\n/).slice(-lineCount).join("\n").trim();
}

function resolveSidecarPort() {
    return parseInteger(process.env.STFC_SIDECAR_PORT, DEFAULT_PORT);
}

function healthUrlForPort(port) {
    return `http://127.0.0.1:${port}/api/health`;
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(`${value ?? ""}`, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
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

async function main() {
    try {
        const exitCode = await runDesktopDev();
        process.exit(exitCode);
    } catch (error) {
        console.error(`[desktop-dev] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

if (process.argv[1] === __filename) {
    await main();
}
