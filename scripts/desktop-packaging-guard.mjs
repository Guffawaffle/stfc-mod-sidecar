import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultDistDir = path.join(repoRoot, "packages", "desktop", "dist");

export function checkDesktopPackagingPreflight(options = {}) {
    const distDir = path.resolve(options.distDir ?? defaultDistDir);
    const runningProcesses = normalizeProcessList(
        options.runningProcesses
            ?? detectRunningPackagedDesktopProcesses({
                distDir,
                platform: options.platform,
                execFileSyncImpl: options.execFileSyncImpl,
            }),
    );

    return {
        ok: runningProcesses.length === 0,
        distDir,
        runningProcesses,
    };
}

export function assertDesktopPackagingPreflight(options = {}) {
    const result = checkDesktopPackagingPreflight(options);
    if (result.ok) {
        return result;
    }

    throw new Error(formatDesktopPackagingPreflightError(result));
}

export function detectRunningPackagedDesktopProcesses(options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform !== "win32") {
        return [];
    }

    const distDir = path.resolve(options.distDir ?? defaultDistDir);
    const execFileSyncImpl = options.execFileSyncImpl ?? execFileSync;
    const script = [
        "$distDir = ($env:STFC_SIDECAR_DIST_DIR ?? '').Trim()",
        "if ([string]::IsNullOrWhiteSpace($distDir)) { '[]'; exit 0 }",
        "$needle = $distDir.ToLowerInvariant()",
        "$matches = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {",
        "  $exe = $_.ExecutablePath",
        "  $cmd = $_.CommandLine",
        "  if (($exe -and $exe.ToLowerInvariant().Contains($needle)) -or ($cmd -and $cmd.ToLowerInvariant().Contains($needle))) {",
        "    [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; executablePath = $exe; commandLine = $cmd }",
        "  }",
        "}",
        "@($matches | Select-Object -First 8) | ConvertTo-Json -Compress",
    ].join("; ");

    const raw = execFileSyncImpl("pwsh", ["-NoLogo", "-NoProfile", "-Command", script], {
        encoding: "utf8",
        env: {
            ...process.env,
            STFC_SIDECAR_DIST_DIR: distDir,
        },
        windowsHide: true,
    });

    return normalizeProcessList(raw.trim() ? JSON.parse(raw) : []);
}

export function formatDesktopPackagingPreflightError(result) {
    const summary = result.runningProcesses
        .slice(0, 3)
        .map((entry) => {
            const location = entry.executablePath || entry.commandLine || "path unavailable";
            return `pid ${entry.pid} ${entry.name} (${location})`;
        })
        .join("; ");

    return [
        `Packaged Companion appears to be running from ${result.distDir}.`,
        "Close the running app and rerun the packaging command.",
        summary ? `Detected: ${summary}` : null,
    ].filter(Boolean).join(" ");
}

function normalizeProcessList(value) {
    if (!value) {
        return [];
    }

    const entries = Array.isArray(value) ? value : [value];
    return entries
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
            pid: Number(entry.pid ?? entry.ProcessId ?? 0),
            name: String(entry.name ?? entry.Name ?? "unknown"),
            executablePath: typeof entry.executablePath === "string"
                ? entry.executablePath
                : (typeof entry.ExecutablePath === "string" ? entry.ExecutablePath : ""),
            commandLine: typeof entry.commandLine === "string"
                ? entry.commandLine
                : (typeof entry.CommandLine === "string" ? entry.CommandLine : ""),
        }))
        .filter((entry) => entry.pid > 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    try {
        assertDesktopPackagingPreflight();
    } catch (error) {
        process.stderr.write(`[sidecar-packaging] ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}