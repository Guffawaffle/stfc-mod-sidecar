import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import electronPath from "electron";

const COMMANDS = new Set(["start", "start-bg", "cycle", "run-managed", "status", "stop", "logs"]);
const DEFAULT_COMMAND = "start";
export const DEFAULT_PORT = 43127;
export const DEFAULT_LOG_LINES = 80;
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
        case "cycle":
            return cycleBackground(args);
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

export async function startManagedDesktopDev(options = {}) {
    const args = {
        skipStop: Boolean(options.skipStop),
        cycle: Boolean(options.cycle),
        launchArgs: Array.isArray(options.launchArgs) ? [...options.launchArgs] : [],
    };
    const action = args.cycle ? "cycle" : "start";
    const before = await readDesktopDevStatusSnapshot();
    const managedState = loadManagedState({ cleanupStale: true });
    if (managedState && args.cycle) {
        await stopManagedDesktopDev();
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

    return {
        ok: true,
        action,
        changed: true,
        startupState: startup.state,
        startupHealth: startup.health ?? null,
        before,
        after: await readDesktopDevStatusSnapshot(),
    };
}

async function startBackground(args) {
    const result = await startManagedDesktopDev({
        skipStop: args.skipStop,
        cycle: args.cycle,
        launchArgs: args.launchArgs,
    });
    const after = result.after;
    console.log(`[desktop-dev] started background desktop dev (pid ${after.pid})`);
    console.log(`[desktop-dev] state ${after.statePath}`);
    console.log(`[desktop-dev] logs ${after.stdoutLogPath} | ${after.stderrLogPath}`);

    if (result.startupState === "healthy") {
        console.log(`[desktop-dev] health ok at ${after.healthUrl}`);
    } else {
        console.log(`[desktop-dev] process is running; health not ready yet at ${after.healthUrl}`);
    }

    return 0;
}

export async function cycleManagedDesktopDev(options = {}) {
    return startManagedDesktopDev({
        ...options,
        cycle: true,
    });
}

async function cycleBackground(args) {
    await cycleManagedDesktopDev({
        skipStop: args.skipStop,
        launchArgs: args.launchArgs,
    });
    return 0;
}

async function runManaged(args) {
    return launchElectron(args, { managed: true });
}

export async function readDesktopDevStatusSnapshot() {
    const expectedPort = resolveSidecarPort();
    const expectedHealthUrl = healthUrlForPort(expectedPort);
    const managedState = readManagedState();

    if (managedState) {
        const running = isProcessAlive(managedState.pid);
        if (!running) {
            return {
                ok: true,
                mode: "stale",
                managed: true,
                unmanagedDetected: false,
                statePresent: true,
                stale: true,
                running: false,
                healthy: false,
                pid: managedState.pid ?? null,
                port: managedState.port ?? expectedPort,
                expectedPort,
                healthUrl: managedState.healthUrl ?? expectedHealthUrl,
                startedAt: managedState.startedAt ?? null,
                pidPath,
                statePath,
                stdoutLogPath,
                stderrLogPath,
                health: null,
            };
        }

        const healthUrl = managedState.healthUrl ?? expectedHealthUrl;
        const health = await fetchHealth(healthUrl, HEALTH_TIMEOUT_MS);
        return {
            ok: true,
            mode: health.ok ? "managed-healthy" : "managed-unavailable",
            managed: true,
            unmanagedDetected: false,
            statePresent: true,
            stale: false,
            running,
            healthy: health.ok,
            pid: managedState.pid ?? null,
            port: managedState.port ?? expectedPort,
            expectedPort,
            healthUrl,
            startedAt: managedState.startedAt ?? null,
            pidPath,
            statePath,
            stdoutLogPath: managedState.stdoutLogPath ?? stdoutLogPath,
            stderrLogPath: managedState.stderrLogPath ?? stderrLogPath,
            health,
        };
    }

    const health = await fetchHealth(expectedHealthUrl, HEALTH_TIMEOUT_MS);
    if (health.ok) {
        return {
            ok: true,
            mode: "unmanaged",
            managed: false,
            unmanagedDetected: true,
            statePresent: false,
            stale: false,
            running: true,
            healthy: true,
            pid: health.payload?.pid ?? null,
            port: health.payload?.port ?? expectedPort,
            expectedPort,
            healthUrl: expectedHealthUrl,
            startedAt: null,
            pidPath,
            statePath,
            stdoutLogPath,
            stderrLogPath,
            health,
        };
    }

    return {
        ok: true,
        mode: "unavailable",
        managed: false,
        unmanagedDetected: false,
        statePresent: false,
        stale: false,
        running: false,
        healthy: false,
        pid: null,
        port: expectedPort,
        expectedPort,
        healthUrl: expectedHealthUrl,
        startedAt: null,
        pidPath,
        statePath,
        stdoutLogPath,
        stderrLogPath,
        health,
    };
}

async function showStatus() {
    const snapshot = await readDesktopDevStatusSnapshot();
    if (snapshot.mode === "stale") {
        clearManagedState();
        console.log("state: stale");
        console.log(`pid: ${snapshot.pid}`);
        console.log(`stateFile: ${snapshot.statePath}`);
        return 0;
    }

    if (snapshot.mode === "managed-healthy" || snapshot.mode === "managed-unavailable") {
        console.log(`state: ${snapshot.mode}`);
        console.log(`pid: ${snapshot.pid}`);
        console.log(`healthUrl: ${snapshot.healthUrl}`);
        console.log(`startedAt: ${snapshot.startedAt}`);
        console.log(`pidFile: ${snapshot.pidPath}`);
        console.log(`stateFile: ${snapshot.statePath}`);
        console.log(`stdoutLog: ${snapshot.stdoutLogPath}`);
        console.log(`stderrLog: ${snapshot.stderrLogPath}`);
        if (snapshot.health?.ok && snapshot.health.payload) {
            console.log(`healthMode: ${snapshot.health.payload.mode ?? "unknown"}`);
        }
        return 0;
    }

    if (snapshot.mode === "unmanaged") {
        console.log("state: unmanaged");
        console.log(`healthUrl: ${snapshot.healthUrl}`);
        return 0;
    }

    console.log("state: unavailable");
    console.log(`healthUrl: ${snapshot.healthUrl}`);
    return 0;
}

export async function stopManagedDesktopDev() {
    const before = await readDesktopDevStatusSnapshot();
    const managedState = readManagedState();
    if (managedState) {
        if (!isProcessAlive(managedState.pid)) {
            clearManagedState();
            return {
                ok: true,
                action: "stop",
                stopped: false,
                reason: "stale_state_removed",
                pid: managedState.pid,
                before,
                after: await readDesktopDevStatusSnapshot(),
            };
        }

        killProcessTree(managedState.pid);
        await waitForExit(managedState.pid, STOP_TIMEOUT_MS);
        clearManagedState();
        return {
            ok: true,
            action: "stop",
            stopped: true,
            reason: "managed_process_stopped",
            pid: managedState.pid,
            before,
            after: await readDesktopDevStatusSnapshot(),
        };
    }

    return {
        ok: true,
        action: "stop",
        stopped: false,
        reason: "not_recorded",
        pid: null,
        before,
        after: before,
    };
}

async function stopManagedDesktop() {
    const result = await stopManagedDesktopDev();
    switch (result.reason) {
        case "not_recorded":
            console.log("[desktop-dev] no managed desktop dev process is recorded");
            break;
        case "stale_state_removed":
            console.log(`[desktop-dev] removed stale desktop dev state for pid ${result.pid}`);
            break;
        default:
            console.log(`[desktop-dev] stopped managed desktop dev (pid ${result.pid})`);
            break;
    }
    return 0;
}

export async function readDesktopDevLogsSnapshot(lineCount = DEFAULT_LOG_LINES) {
    const normalizedLines = parseInteger(lineCount, DEFAULT_LOG_LINES);
    const stdoutTail = await readLogTail(stdoutLogPath, normalizedLines);
    const stderrTail = await readLogTail(stderrLogPath, normalizedLines);
    return {
        ok: true,
        lineCount: normalizedLines,
        logsDir,
        stdoutLogPath,
        stderrLogPath,
        stdoutTail,
        stderrTail,
        available: Boolean(stdoutTail || stderrTail),
    };
}

async function showLogs(lineCount) {
    const snapshot = await readDesktopDevLogsSnapshot(lineCount);
    if (!snapshot.available) {
        console.log(`[desktop-dev] no managed desktop dev logs found at ${logsDir}`);
        return 0;
    }

    if (snapshot.stdoutTail) {
        console.log(`== stdout (${snapshot.stdoutLogPath}) ==`);
        console.log(snapshot.stdoutTail);
    }

    if (snapshot.stderrTail) {
        console.log(`== stderr (${snapshot.stderrLogPath}) ==`);
        console.log(snapshot.stderrTail);
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
        shell: invocation.shell ?? false,
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

export async function fetchHealth(healthUrl, timeoutMs = HEALTH_TIMEOUT_MS) {
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

export function resolveSidecarPort() {
    return parseInteger(process.env.STFC_SIDECAR_PORT, DEFAULT_PORT);
}

export function healthUrlForPort(port) {
    return `http://127.0.0.1:${port}/api/health`;
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(`${value ?? ""}`, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveNpmInvocation(args) {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath) {
        return {
            command: process.execPath,
            args: [npmExecPath, ...args],
            shell: false,
        };
    }

    const nodeDir = path.dirname(process.execPath);
    const npmCliCandidates = [
        path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(repoRoot, "node_modules", "npm", "bin", "npm-cli.js"),
    ];
    const npmCliPath = npmCliCandidates.find((candidate) => existsSync(candidate));
    if (npmCliPath) {
        return {
            command: process.execPath,
            args: [npmCliPath, ...args],
            shell: false,
        };
    }

    return {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        args,
        shell: process.platform === "win32",
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
