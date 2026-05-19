#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertDesktopPackagingPreflight } from "./desktop-packaging-guard.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const desktopRoot = path.join(repoRoot, "packages", "desktop");
const desktopPackage = JSON.parse(readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
const npmCliPath = resolveNpmCliPath();
const electronBuilderCliPath = path.join(repoRoot, "node_modules", "electron-builder", "cli.js");

const COMMAND_METADATA = new Map([
    ["status", { description: "Show repository health and git status", sideEffects: "read" }],
    ["build", { description: "Build all sidecar packages", sideEffects: "write" }],
    ["test", { description: "Run all sidecar package tests", sideEffects: "write" }],
    ["check", { description: "Build and test all sidecar packages", sideEffects: "write" }],
    ["dist:win", { description: "Build Windows desktop distribution artifacts", sideEffects: "write" }],
    ["ci", { description: "Build, test, and package Windows distribution artifacts", sideEffects: "write" }],
]);

const COMMANDS = new Map([
    ["status", statusCommand],
    ["build", buildCommand],
    ["test", testCommand],
    ["check", checkCommand],
    ["dist:win", distWinCommand],
    ["ci", ciCommand],
]);

const commandName = process.argv[2] ?? "help";

async function main() {
    if (commandName === "list") {
        emitInventory();
        return;
    }

    if (["help", "--help", "-h"].includes(commandName)) {
        emitResult({
            command: "help",
            success: true,
            durationMs: 0,
            commands: commandInventory(),
            usage: "npm run ax -- <status|build|test|check|dist:win|ci|list>",
        });
        return;
    }

    const command = COMMANDS.get(commandName);
    if (!command) {
        emitResult({
            command: commandName,
            success: false,
            durationMs: 0,
            errors: [`Unknown ax command: ${commandName}`],
            hints: [`Known commands: ${Array.from(COMMANDS.keys()).join(", ")}`],
        });
        process.exit(1);
    }

    const start = Date.now();
    const result = await command();
    emitResult({ command: commandName, durationMs: Date.now() - start, ...result });
    process.exit(result.success ? 0 : 1);
}

function commandInventory() {
    return Array.from(COMMANDS.keys()).map((name) => {
        const metadata = COMMAND_METADATA.get(name) ?? {};
        return {
            name,
            description: metadata.description ?? name,
            sideEffects: metadata.sideEffects ?? "unknown",
            parameters: [],
        };
    });
}

function emitInventory() {
    process.stdout.write(`${JSON.stringify({
        ok: true,
        usage: "npm run ax -- <command> [args...]",
        commands: commandInventory(),
    }, null, 2)}\n`);
}

async function statusCommand() {
    const status = await runStep("git:status", "git", ["status", "--short", "--branch"], {
        timeoutMs: 30_000,
    });
    return {
        success: status.success,
        steps: [status],
    };
}

async function buildCommand() {
    return sequence([
        () => runNpmStep("build", ["run", "build"], { timeoutMs: 180_000 }),
    ]);
}

async function testCommand() {
    return sequence([
        () => runNpmStep("test", ["test"], { timeoutMs: 180_000 }),
    ]);
}

async function checkCommand() {
    return sequence([
        () => runNpmStep("build", ["run", "build"], { timeoutMs: 180_000 }),
        () => runNpmStep("test", ["test"], { timeoutMs: 180_000 }),
    ]);
}

async function ciCommand() {
    return sequence([
        () => desktopDistPreflightStep(),
        () => runNpmStep("build", ["run", "build"], { timeoutMs: 180_000 }),
        () => runNpmStep("test", ["test"], { timeoutMs: 180_000 }),
        () => distWinStep(),
    ]);
}

async function distWinCommand() {
    return sequence([
        () => desktopDistPreflightStep(),
        () => runNpmStep("core:build", ["run", "build", "--workspace", "@stfc-mod-sidecar/core"], {
            timeoutMs: 180_000,
        }),
        () => distWinStep(),
    ]);
}

async function desktopDistPreflightStep() {
    const startedAt = Date.now();
    const name = "desktop:dist:preflight";
    const command = "packaged desktop lock check";
    process.stderr.write(`[ax] start ${name}: ${command}\n`);

    try {
        const result = assertDesktopPackagingPreflight({ distDir: path.join(desktopRoot, "dist") });
        process.stderr.write(`[ax] finish ${name}: ok\n`);
        return {
            name,
            success: true,
            command,
            exitCode: 0,
            signal: null,
            durationMs: Date.now() - startedAt,
            timedOut: false,
            completedByProbe: false,
            summary: `No running packaged Companion detected under ${result.distDir}`,
        };
    } catch (error) {
        process.stderr.write(`[ax] finish ${name}: failed\n`);
        return {
            name,
            success: false,
            command,
            exitCode: 1,
            signal: null,
            durationMs: Date.now() - startedAt,
            timedOut: false,
            completedByProbe: false,
            error: error instanceof Error ? error.message : String(error),
            stderrTail: error instanceof Error ? error.message : String(error),
        };
    }
}

function distWinStep() {
    const startedAt = new Date();
    return runStep("desktop:dist:win", process.execPath, [electronBuilderCliPath, "--win", "--config", "electron-builder.config.cjs", "--publish", "never"], {
        cwd: desktopRoot,
        timeoutMs: 900_000,
        displayCommand: "electron-builder --win --config electron-builder.config.cjs --publish never",
        completionProbe: () => windowsArtifactsExistSince(startedAt),
        completionProbeIdleMs: 20_000,
        completionProbeSummary: "Windows installer and portable artifacts exist; terminated lingering package process.",
    });
}

async function sequence(stepFactories) {
    const steps = [];
    for (const stepFactory of stepFactories) {
        const step = await stepFactory();
        steps.push(step);
        if (!step.success) {
            return { success: false, steps };
        }
    }

    return { success: true, steps };
}

function runStep(name, command, args, options = {}) {
    const cwd = options.cwd ?? repoRoot;
    const timeoutMs = options.timeoutMs ?? 120_000;
    const startedAt = Date.now();
    const displayCommand = options.displayCommand ?? commandLine(command, args);
    process.stderr.write(`[ax] start ${name}: ${displayCommand}\n`);

    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env: { ...process.env, ...(options.env ?? {}) },
            stdio: ["ignore", "pipe", "pipe"],
            shell: options.shell ?? false,
            windowsHide: true,
        });
        let stdoutTail = "";
        let stderrTail = "";
        let lastOutputAt = Date.now();
        let timedOut = false;
        let completedByProbe = false;
        let completionSummary = "";

        const appendTail = (current, chunk) => `${current}${chunk}`.slice(-12_000);
        child.stdout?.on("data", (chunk) => {
            const text = chunk.toString();
            lastOutputAt = Date.now();
            stdoutTail = appendTail(stdoutTail, text);
            process.stdout.write(text);
        });
        child.stderr?.on("data", (chunk) => {
            const text = chunk.toString();
            lastOutputAt = Date.now();
            stderrTail = appendTail(stderrTail, text);
            process.stderr.write(text);
        });

        const timeout = setTimeout(() => {
            timedOut = true;
            killProcessTree(child.pid);
        }, timeoutMs);

        const probe = options.completionProbe
            ? setInterval(() => {
                if (Date.now() - lastOutputAt < options.completionProbeIdleMs) {
                    return;
                }

                if (!options.completionProbe()) {
                    return;
                }

                completedByProbe = true;
                completionSummary = options.completionProbeSummary ?? "Completion probe passed; terminated lingering process.";
                killProcessTree(child.pid);
            }, 1000)
            : null;

        child.on("error", (error) => {
            clearTimeout(timeout);
            if (probe) {
                clearInterval(probe);
            }
            resolve({
                name,
                success: false,
                command: displayCommand,
                durationMs: Date.now() - startedAt,
                error: error.message,
                stdoutTail,
                stderrTail,
            });
        });

        child.on("close", (exitCode, signal) => {
            clearTimeout(timeout);
            if (probe) {
                clearInterval(probe);
            }

            const success = exitCode === 0 || completedByProbe;
            process.stderr.write(`[ax] finish ${name}: ${success ? "ok" : "failed"}\n`);
            resolve({
                name,
                success,
                command: displayCommand,
                exitCode,
                signal,
                durationMs: Date.now() - startedAt,
                timedOut,
                completedByProbe,
                summary: completionSummary || undefined,
                stdoutTail: success ? undefined : stdoutTail,
                stderrTail: success ? undefined : stderrTail,
            });
        });
    });
}

function runNpmStep(name, args, options = {}) {
    if (npmCliPath) {
        return runStep(name, process.execPath, [npmCliPath, ...args], {
            ...options,
            displayCommand: `npm ${args.join(" ")}`,
        });
    }

    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    return runStep(name, npmCommand, args, {
        ...options,
        shell: process.platform === "win32",
        displayCommand: `npm ${args.join(" ")}`,
    });
}

function windowsArtifactsExistSince(startedAt) {
    const version = desktopPackage.version;
    const distDir = path.join(desktopRoot, "dist");
    const setupPath = path.join(distDir, `STFC Community Mod Companion-Setup-${version}-x64.exe`);
    const portablePath = path.join(distDir, `STFC Community Mod Companion-Portable-${version}-x64.exe`);
    return [setupPath, portablePath].every((artifactPath) => {
        if (!existsSync(artifactPath)) {
            return false;
        }

        return statSync(artifactPath).mtime >= startedAt;
    });
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

function commandLine(command, args) {
    return [command, ...args].join(" ");
}

function resolveNpmCliPath() {
    if (process.env.npm_execpath && existsSync(process.env.npm_execpath)) {
        return process.env.npm_execpath;
    }

    const nodeDir = path.dirname(process.execPath);
    const candidates = [
        path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"),
        path.join(repoRoot, "node_modules", "npm", "bin", "npm-cli.js"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function emitResult(result) {
    process.stdout.write(`\n${JSON.stringify({ ax: result }, null, 2)}\n`);
}

main().catch((error) => {
    emitResult({
        command: commandName,
        success: false,
        durationMs: 0,
        errors: [error instanceof Error ? error.message : String(error)],
    });
    process.exit(1);
});