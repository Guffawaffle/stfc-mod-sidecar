import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readDesktopDevStatusSnapshot } from "./desktop-dev.mjs";
import { readObservedHostileReportCommandPayload } from "./observed-hostile-ax.mjs";

const REPRO_BUNDLE_PROTOCOL_VERSION = "stfc.sidecar.repro-bundle.ax.v1";
const DEFAULT_DEBUG_LIMIT = 20;
const DEFAULT_OBSERVED_LIMIT = 20;
const DEFAULT_NATIVE_RECENT_LIMIT = 20;
const DEFAULT_LOG_LAST = 80;
const DEFAULT_REPORT_PREVIEW_LIMIT = 5;
const DEFAULT_TIMEOUT_SEC = 4;

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

export function parseReproBundleAxArgs(argv = []) {
    const parsed = {
        modRepoRoot: "",
        serverUrl: "",
        label: "",
        debugLimit: DEFAULT_DEBUG_LIMIT,
        observedLimit: DEFAULT_OBSERVED_LIMIT,
        nativeRecentLimit: DEFAULT_NATIVE_RECENT_LIMIT,
        logLast: DEFAULT_LOG_LAST,
        reportPreview: DEFAULT_REPORT_PREVIEW_LIMIT,
        timeoutSec: DEFAULT_TIMEOUT_SEC,
        skipMark: false,
        skipLex: false,
        lexDryRun: false,
        summaryOnly: false,
        jsonOut: "",
        outputDir: "",
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index] ?? "");
        switch (arg) {
            case "--mod-repo-root":
                parsed.modRepoRoot = readRequiredValue(argv, ++index, arg);
                break;
            case "--server-url":
                parsed.serverUrl = readRequiredValue(argv, ++index, arg);
                break;
            case "--label":
                parsed.label = readRequiredValue(argv, ++index, arg);
                break;
            case "--debug-limit":
                parsed.debugLimit = normalizePositiveInteger(readRequiredValue(argv, ++index, arg), DEFAULT_DEBUG_LIMIT, 100);
                break;
            case "--observed-limit":
                parsed.observedLimit = normalizePositiveInteger(readRequiredValue(argv, ++index, arg), DEFAULT_OBSERVED_LIMIT, 100);
                break;
            case "--native-recent-limit":
                parsed.nativeRecentLimit = normalizePositiveInteger(readRequiredValue(argv, ++index, arg), DEFAULT_NATIVE_RECENT_LIMIT, 100);
                break;
            case "--log-last":
                parsed.logLast = normalizePositiveInteger(readRequiredValue(argv, ++index, arg), DEFAULT_LOG_LAST, 500);
                break;
            case "--report-preview":
                parsed.reportPreview = normalizePositiveInteger(readRequiredValue(argv, ++index, arg), DEFAULT_REPORT_PREVIEW_LIMIT, 50);
                break;
            case "--timeout-sec":
                parsed.timeoutSec = normalizePositiveInteger(readRequiredValue(argv, ++index, arg), DEFAULT_TIMEOUT_SEC, 30);
                break;
            case "--json-out":
                parsed.jsonOut = readRequiredValue(argv, ++index, arg);
                break;
            case "--output-dir":
                parsed.outputDir = readRequiredValue(argv, ++index, arg);
                break;
            case "--skip-mark":
                parsed.skipMark = true;
                break;
            case "--skip-lex":
                parsed.skipLex = true;
                break;
            case "--lex-dry-run":
                parsed.lexDryRun = true;
                break;
            case "--summary-only":
                parsed.summaryOnly = true;
                break;
            default:
                throw new Error(`Unknown repro bundle option: ${arg}`);
        }
    }

    return parsed;
}

export async function reproBundleCommand(argv = []) {
    const options = parseReproBundleAxArgs(argv);
    const payload = await buildReproBundlePayload(options);
    return payload.ok === false
        ? { success: false, errors: [payload.error ?? "Repro bundle capture failed"], data: payload }
        : { success: true, data: payload };
}

export async function buildReproBundlePayload(options = {}) {
    const generatedAt = new Date().toISOString();
    const modRepoRoot = resolveModRepoRoot(options.modRepoRoot);
    const desktop = await readDesktopDevStatusSnapshot();
    const serverUrl = resolveSidecarBaseUrl(options.serverUrl || desktop.healthUrl);
    const label = options.label || `ax repro bundle ${generatedAt}`;
    const warnings = [];
    const artifactPlan = resolveReproBundleArtifactPlan(options);

    const nativeMark = options.skipMark
        ? {
            attempted: false,
            ok: true,
            skipped: true,
            reason: "skip_mark_requested",
        }
        : await runModAxCommand(modRepoRoot, "mark", {
            Label: label,
            Source: "sidecar-repro-bundle",
        });
    if (nativeMark.attempted && nativeMark.ok === false) {
        warnings.push(`Native mark failed. ${nativeMark.error ?? "Unknown native mark error"}`);
    }

    const [nativeLogSlice, nativeRecentEvents, sidecarDebugEvents, sidecarObservedEvents, observedHostileReport] = await Promise.all([
        runModAxCommand(modRepoRoot, "log-slice", {
            Last: options.logLast,
        }),
        runModAxCommand(modRepoRoot, "recent-events", {
            Last: options.nativeRecentLimit,
            Summary: true,
        }),
        fetchSidecarEventSnapshot(serverUrl, "debug", options.debugLimit, options.timeoutSec),
        fetchSidecarEventSnapshot(serverUrl, "observed", options.observedLimit, options.timeoutSec),
        readObservedHostileReportCommandPayload({
            source: "route",
            serverUrl,
            previewLimit: options.reportPreview,
            timeoutSec: options.timeoutSec,
            jsonOut: artifactPlan.observedHostileReportJsonOut,
            markdownOut: artifactPlan.observedHostileReportMarkdownOut,
        }),
    ]);

    if (nativeLogSlice.ok === false) {
        warnings.push(`Native log slice failed. ${nativeLogSlice.error ?? "Unknown native log error"}`);
    }
    if (nativeRecentEvents.ok === false) {
        warnings.push(`Native recent-events failed. ${nativeRecentEvents.error ?? "Unknown recent-events error"}`);
    }
    if (sidecarDebugEvents.ok === false) {
        warnings.push(`Sidecar debug events unavailable. ${sidecarDebugEvents.error ?? "Unknown debug event error"}`);
    }
    if (sidecarObservedEvents.ok === false) {
        warnings.push(`Sidecar observed events unavailable. ${sidecarObservedEvents.error ?? "Unknown observed event error"}`);
    }
    if (observedHostileReport.ok === false) {
        warnings.push(`Observed hostile report unavailable. ${observedHostileReport.error ?? "Unknown report error"}`);
    }

    const payload = {
        ok: nativeLogSlice.ok !== false
            && sidecarDebugEvents.ok !== false
            && sidecarObservedEvents.ok !== false
            && observedHostileReport.ok !== false,
        protocolVersion: REPRO_BUNDLE_PROTOCOL_VERSION,
        detail: "repro-bundle",
        generatedAt,
        label,
        modRepoRoot,
        sidecarRepoRoot: repoRoot,
        serverUrl,
        desktop,
        native: {
            mark: nativeMark,
            logSlice: nativeLogSlice,
            recentEvents: nativeRecentEvents,
        },
        sidecar: {
            debugEvents: sidecarDebugEvents,
            observedEvents: sidecarObservedEvents,
            observedHostileReport,
        },
        lex: options.skipLex
            ? {
                attempted: false,
                ok: true,
                skipped: true,
                reason: "skip_lex_requested",
            }
            : null,
        warnings,
    };

    if (!options.skipLex) {
        payload.lex = await rememberReproBundleFrame(payload, { dryRun: options.lexDryRun });
        if (payload.lex.ok === false) {
            warnings.push(`Lex remember failed. ${payload.lex.error ?? "Unknown Lex error"}`);
        }
    }

    const artifacts = {
        ...(artifactPlan.outputDir ? { outputDir: artifactPlan.outputDir } : {}),
        ...(artifactPlan.bundleJsonOut ? { jsonOut: artifactPlan.bundleJsonOut } : {}),
        ...(artifactPlan.observedHostileReportJsonOut ? { observedHostileReportJsonOut: artifactPlan.observedHostileReportJsonOut } : {}),
        ...(artifactPlan.observedHostileReportMarkdownOut ? { observedHostileReportMarkdownOut: artifactPlan.observedHostileReportMarkdownOut } : {}),
    };
    if (Object.keys(artifacts).length > 0) {
        payload.artifacts = artifacts;
    }

    if (artifactPlan.bundleJsonOut) {
        mkdirSync(path.dirname(artifactPlan.bundleJsonOut), { recursive: true });
        writeFileSync(artifactPlan.bundleJsonOut, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }

    if (!payload.ok && !payload.error) {
        payload.error = "Repro bundle did not capture every required section.";
    }

    return options.summaryOnly ? summarizeReproBundlePayload(payload) : payload;
}

export function buildReproBundleLexFrame(bundle = {}) {
    const reportSummary = bundle.sidecar?.observedHostileReport?.summary ?? {};
    const debugReturned = bundle.sidecar?.debugEvents?.returnedLines ?? 0;
    const observedReturned = bundle.sidecar?.observedEvents?.returnedLines ?? 0;
    const markState = bundle.native?.mark?.ok === false ? "mark-failed" : bundle.native?.mark?.skipped ? "mark-skipped" : "mark-ok";

    return {
        referencePoint: bundle.label ?? "ax repro bundle",
        summary: `repro bundle ${markState}; report ${reportSummary.submissionReadyCount ?? 0}/${reportSummary.readyForMaintainerReviewCount ?? 0}/${reportSummary.needsIdentifierReviewCount ?? 0}; sidecar debug ${debugReturned}; observed ${observedReturned}`,
        next: "Review bundle payload, recent sidecar events, and observed hostile report preview.",
        modules: "stfc-mod-sidecar,stfc-mod",
        keywords: "repro-bundle,observed-hostiles,sidecar,native-log",
        permissions: "local-files,localhost",
    };
}

export function summarizeReproBundlePayload(payload = {}) {
    return {
        ok: payload.ok !== false,
        protocolVersion: REPRO_BUNDLE_PROTOCOL_VERSION,
        detail: "repro-bundle-summary",
        generatedAt: payload.generatedAt ?? null,
        label: payload.label ?? null,
        modRepoRoot: payload.modRepoRoot ?? null,
        sidecarRepoRoot: payload.sidecarRepoRoot ?? null,
        serverUrl: payload.serverUrl ?? null,
        summaryOnly: true,
        desktop: summarizeDesktopSnapshot(payload.desktop),
        summary: {
            report: payload.sidecar?.observedHostileReport?.summary ?? null,
            sidecarDebugReturned: payload.sidecar?.debugEvents?.returnedLines ?? 0,
            sidecarObservedReturned: payload.sidecar?.observedEvents?.returnedLines ?? 0,
            nativeLogSelectedCount: payload.native?.logSlice?.data?.selectedCount ?? 0,
            nativeRecentEventsReturned: extractRecentEventsReturned(payload.native?.recentEvents),
        },
        sections: {
            native: {
                markOk: payload.native?.mark?.ok ?? false,
                logSliceOk: payload.native?.logSlice?.ok ?? false,
                recentEventsOk: payload.native?.recentEvents?.ok ?? false,
            },
            sidecar: {
                debugEventsOk: payload.sidecar?.debugEvents?.ok ?? false,
                observedEventsOk: payload.sidecar?.observedEvents?.ok ?? false,
                observedHostileReportOk: payload.sidecar?.observedHostileReport?.ok ?? false,
            },
            lex: {
                attempted: payload.lex?.attempted ?? false,
                ok: payload.lex?.ok ?? false,
                dryRun: payload.lex?.dryRun ?? false,
                skipped: payload.lex?.skipped ?? false,
            },
        },
        artifacts: payload.artifacts ?? {},
        warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        error: payload.error ?? undefined,
    };
}

async function rememberReproBundleFrame(bundle, options = {}) {
    const frame = buildReproBundleLexFrame(bundle);
    const args = [
        "@smartergpt/lex",
        "--json",
        "remember",
        "--reference-point",
        frame.referencePoint,
        "--summary",
        frame.summary,
        "--next",
        frame.next,
        "--modules",
        frame.modules,
        "--keywords",
        frame.keywords,
        "--permissions",
        frame.permissions,
        "--skip-policy",
    ];
    if (options.dryRun) {
        args.push("--dry-run");
    }

    try {
        const invocation = resolveNpxInvocation(args);
        const result = await runProcess(invocation.command, invocation.args, {
            cwd: repoRoot,
            shell: invocation.shell,
        });
        const parsed = parseJsonMaybe(result.stdout);
        return {
            attempted: true,
            ok: result.exitCode === 0,
            dryRun: Boolean(options.dryRun),
            command: `npx ${args.join(" ")}`,
            data: parsed,
            error: result.exitCode === 0 ? null : firstNonEmpty(result.stderr, result.stdout, `Lex exited with code ${result.exitCode}`),
        };
    } catch (error) {
        return {
            attempted: true,
            ok: false,
            dryRun: Boolean(options.dryRun),
            command: `npx ${args.join(" ")}`,
            data: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function fetchSidecarEventSnapshot(serverUrl, scope, limit, timeoutSec) {
    const requestUrl = `${serverUrl}/api/events?scope=${encodeURIComponent(scope)}&detail=summary&limit=${encodeURIComponent(limit)}`;
    try {
        const response = await fetch(requestUrl, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(normalizePositiveInteger(timeoutSec, DEFAULT_TIMEOUT_SEC, 30) * 1000),
        });
        if (!response.ok) {
            return {
                ok: false,
                scope,
                url: requestUrl,
                error: `Route returned ${response.status}`,
            };
        }

        const payload = await response.json();
        return {
            ok: payload.ok !== false,
            scope,
            url: requestUrl,
            source: payload.source ?? null,
            storageBackend: payload.storageBackend ?? null,
            totalLines: payload.totalLines ?? 0,
            returnedLines: payload.returnedLines ?? 0,
            generatedAt: payload.generatedAt ?? null,
            events: Array.isArray(payload.events) ? payload.events : [],
            error: payload.ok === false ? payload.error ?? "Event snapshot unavailable" : undefined,
        };
    } catch (error) {
        return {
            ok: false,
            scope,
            url: requestUrl,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function runModAxCommand(modRepoRoot, command, parameters = {}) {
    const axScript = path.join(modRepoRoot, ".ax", "ax.ps1");
    const args = [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        axScript,
        command,
        ...toPowerShellArgs(parameters),
    ];

    try {
        const result = await runProcess("pwsh", args, { cwd: modRepoRoot });
        const parsed = parseJsonMaybe(result.stdout);
        return {
            attempted: true,
            ok: result.exitCode === 0,
            command,
            parameters,
            data: parsed,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            error: result.exitCode === 0 ? null : firstNonEmpty(result.stderr, result.stdout, `${command} exited with code ${result.exitCode}`),
        };
    } catch (error) {
        return {
            attempted: true,
            ok: false,
            command,
            parameters,
            data: null,
            stdout: "",
            stderr: "",
            exitCode: 1,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function toPowerShellArgs(parameters = {}) {
    const args = [];
    for (const [name, value] of Object.entries(parameters)) {
        if (value === undefined || value === null || value === false || value === "") {
            continue;
        }
        args.push(`-${name}`);
        if (value !== true) {
            args.push(String(value));
        }
    }
    return args;
}

function resolveModRepoRoot(requestedRepoRoot) {
    const candidates = [
        requestedRepoRoot,
        process.env.STFC_MOD_REPO_ROOT,
        process.env.AX_REPO_GUFFA_ROOT,
        path.resolve(repoRoot, "..", "stfc-mod"),
    ].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        const axScript = path.join(resolved, ".ax", "ax.ps1");
        if (path.isAbsolute(resolved) && resolved && axScript && path.basename(axScript) && existsPath(axScript)) {
            return resolved;
        }
    }

    throw new Error("Unable to resolve the stfc-mod repo root with a callable .ax/ax.ps1 wrapper.");
}

function resolveSidecarBaseUrl(serverUrl) {
    const candidate = String(serverUrl ?? "").trim();
    if (candidate) {
        const trimmed = candidate.replace(/\/+$/, "");
        const match = /^(https?:\/\/.+?)\/api\/health\/?$/.exec(trimmed);
        return (match?.[1] ?? trimmed).replace(/\/+$/, "");
    }
    return "http://127.0.0.1:43127";
}

export function resolveReproBundleArtifactPlan(options = {}) {
    const outputDir = String(options.outputDir ?? "").trim()
        ? resolveOutputPath(String(options.outputDir ?? "").trim())
        : "";
    const bundleJsonOut = String(options.jsonOut ?? "").trim()
        ? resolveOutputPath(String(options.jsonOut ?? "").trim())
        : outputDir
            ? path.join(outputDir, "repro-bundle.json")
            : "";

    return {
        outputDir,
        bundleJsonOut,
        observedHostileReportJsonOut: outputDir ? path.join(outputDir, "observed-hostile-community-report.json") : "",
        observedHostileReportMarkdownOut: outputDir ? path.join(outputDir, "observed-hostile-community-report.md") : "",
    };
}

function resolveOutputPath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
}

export function resolveNpxInvocation(args = []) {
    const nodeDir = path.dirname(process.execPath);
    const npxCliCandidates = [
        path.join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js"),
        path.join(repoRoot, "node_modules", "npm", "bin", "npx-cli.js"),
    ];
    const npxCliPath = npxCliCandidates.find((candidate) => existsSync(candidate));
    if (npxCliPath) {
        return {
            command: process.execPath,
            args: [npxCliPath, ...args],
            shell: false,
        };
    }

    return {
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        args,
        shell: process.platform === "win32",
    };
}

async function runProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd ?? repoRoot,
            env: { ...process.env, ...(options.env ?? {}) },
            stdio: ["ignore", "pipe", "pipe"],
            shell: options.shell ?? false,
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (exitCode, signal) => {
            resolve({
                exitCode: exitCode ?? 1,
                signal: signal ?? null,
                stdout,
                stderr,
            });
        });
    });
}

function parseJsonMaybe(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

function normalizePositiveInteger(value, fallback, max) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    return Math.min(Math.max(normalized, 1), max);
}

function readRequiredValue(argv, index, flagName) {
    if (index >= argv.length) {
        throw new Error(`Missing value for ${flagName}`);
    }
    return String(argv[index] ?? "");
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) {
            return text;
        }
    }
    return "";
}

function existsPath(filePath) {
    return path.isAbsolute(filePath) && Boolean(filePath) && existsSync(filePath);
}

function summarizeDesktopSnapshot(snapshot = {}) {
    return {
        mode: snapshot.mode ?? null,
        managed: snapshot.managed ?? false,
        healthy: snapshot.healthy ?? false,
        running: snapshot.running ?? false,
        pid: snapshot.pid ?? null,
        port: snapshot.port ?? null,
        healthUrl: snapshot.healthUrl ?? null,
        startedAt: snapshot.startedAt ?? null,
    };
}

function extractRecentEventsReturned(recentEvents = {}) {
    const returnedCount = recentEvents?.data?.returnedCount;
    if (typeof returnedCount === "number" && Number.isFinite(returnedCount)) {
        return Math.trunc(returnedCount);
    }
    const serverReturnedCount = recentEvents?.data?.serverReturnedCount;
    if (typeof serverReturnedCount === "number" && Number.isFinite(serverReturnedCount)) {
        return Math.trunc(serverReturnedCount);
    }
    const resultItems = Array.isArray(recentEvents?.data?.result) ? recentEvents.data.result : null;
    if (resultItems) {
        return resultItems.length;
    }
    const lineItems = Array.isArray(recentEvents?.data?.lines) ? recentEvents.data.lines : null;
    if (lineItems) {
        return lineItems.length;
    }
    return 0;
}
