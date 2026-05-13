#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { normalizeCommunityModReleaseProfile } from "../packages/viewer/community-mod-release-catalog.mjs";

const DEFAULT_GAME_DIR = "C:\\Games\\dev\\Star Trek Fleet Command\\default\\game";
const DEFAULT_PORT = 43128;
const DEFAULT_PROFILE = "netniv-basic";
const ARTIFACT_EXTENSIONS = new Set([".toml", ".vars", ".log", ".jsonl"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const controlScript = path.join(repoRoot, "scripts", "viewer-server-control.mjs");
let smokeConfig = null;

async function main() {
    const startedAt = Date.now();
    const config = parseArgs(process.argv.slice(2));
    smokeConfig = config;
    assertSafeDevGameDirectory(config);

    const paths = smokePaths(config.gameDirectory);
    await requireFile(paths.primeExe, "prime.exe");
    await requireFile(paths.versionDll, "version.dll");

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-dev-mod-smoke-"));
    const originalDllCopy = path.join(tempDir, "version.dll.original");
    await fs.copyFile(paths.versionDll, originalDllCopy);

    const originalDllSha256 = await sha256File(paths.versionDll);
    const settingsSnapshot = await snapshotSettingsArtifacts(config.gameDirectory);
    const backupsBefore = await listBackupFiles(paths.backupDirectory);
    let serverStarted = false;

    try {
        await startServer(config);
        serverStarted = true;

        const baseUrl = `http://127.0.0.1:${config.port}`;
        const health = await getJson(`${baseUrl}/api/health`);
        if (health.ok !== true || health.gameDir !== path.resolve(config.gameDirectory)) {
            throw new Error(`viewer health did not match target game dir: ${JSON.stringify(health)}`);
        }

        const uninstall = await uninstallCurrentMod(baseUrl);
        if (await fileExists(paths.versionDll)) {
            throw new Error("version.dll still exists after uninstall execution");
        }

        const backupsAfterUninstall = await listBackupFiles(paths.backupDirectory);
        const newBackups = backupsAfterUninstall.filter((entry) => !backupsBefore.some((before) => before.name === entry.name));
        if (newBackups.length > 0) {
            throw new Error(`uninstall created unexpected backup file(s): ${newBackups.map((entry) => entry.name).join(", ")}`);
        }

        const install = await installSelectedProfile(baseUrl, config.profile);
        const installedDllSha256 = await sha256File(paths.versionDll);
        const postInstallPlan = await getJson(`${baseUrl}/api/mod/install-plan?profile=${encodeURIComponent(config.profile)}`);
        const finalHealth = await getJson(`${baseUrl}/api/health`);
        const changedArtifacts = await changedSettingsArtifacts(settingsSnapshot);

        if (postInstallPlan.status !== "current") {
            throw new Error(`post-install plan was not current: ${postInstallPlan.status}`);
        }

        if (finalHealth.communityModInstall?.classification !== config.profile) {
            throw new Error(`final install classification was ${finalHealth.communityModInstall?.classification ?? "unknown"}`);
        }

        if (changedArtifacts.length > 0) {
            throw new Error(`settings/log artifacts changed: ${changedArtifacts.map((entry) => entry.name).join(", ")}`);
        }

        const receipt = {
            ok: true,
            smoke: "community-mod-dev-reinstall",
            durationMs: Date.now() - startedAt,
            gameDirectory: path.resolve(config.gameDirectory),
            profile: config.profile,
            originalDllSha256,
            installedDllSha256,
            uninstall,
            install,
            postInstallPlan: {
                status: postInstallPlan.status,
                action: postInstallPlan.action,
                summary: postInstallPlan.summary,
            },
            finalInstall: {
                classification: finalHealth.communityModInstall?.classification ?? "unknown",
                state: finalHealth.communityModInstall?.state ?? "unknown",
                dllSha256: finalHealth.communityModInstall?.dll?.sha256 ?? "",
            },
            settingsAndLogs: {
                cleanupRequested: false,
                snapshotCount: settingsSnapshot.length,
                changedCount: changedArtifacts.length,
            },
            safety: {
                usesViewerApi: true,
                devGameDirectoryRequired: !config.allowNonDevGameDirectory,
                temporaryDllRecoveryCopyOutsideGameDirectory: true,
                uninstallCreatedGameDirectoryBackup: false,
                backupFileCountBefore: backupsBefore.length,
                backupFileCountAfterUninstall: backupsAfterUninstall.length,
            },
        };
        console.log(JSON.stringify(receipt, null, 2));
    } catch (error) {
        await restoreOriginalDllIfMissing(paths.versionDll, originalDllCopy);
        throw error;
    } finally {
        if (serverStarted) {
            await stopServer().catch((error) => {
                console.error(`[dev-smoke] failed to stop viewer server: ${error.message}`);
            });
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

async function uninstallCurrentMod(baseUrl) {
    const confirmation = await postJson(`${baseUrl}/api/mod/uninstall-confirmation`, { deleteSettingsAndLogs: false });
    if (confirmation.status !== "ready_for_confirmation") {
        throw new Error(`uninstall confirmation was ${confirmation.status}: ${confirmation.summary}`);
    }

    const execution = await postJson(`${baseUrl}/api/mod/uninstall-execution`, {
        enableExecution: true,
        acknowledgement: confirmation.confirmation?.acknowledgement ?? "",
        confirmedCurrentSha256: confirmation.current?.dllSha256 ?? "",
        confirmedDestinationPath: confirmation.target?.destinationPath ?? "",
        deleteSettingsAndLogs: false,
    });
    if (execution.status !== "removed") {
        throw new Error(`uninstall execution was ${execution.status}: ${execution.summary}`);
    }

    if (execution.receipt?.backup?.created === true || execution.receipt?.backup?.path) {
        throw new Error("uninstall execution reported a DLL backup receipt");
    }

    if (execution.receipt?.settings?.touched === true) {
        throw new Error("uninstall execution touched settings/log artifacts despite cleanup being disabled");
    }

    return {
        status: execution.status,
        action: confirmation.action,
        scopedProcessCheck: confirmation.gameProcess?.scopedToTarget === true,
        backupRequired: execution.receipt?.backup?.required === true,
        backupCreated: execution.receipt?.backup?.created === true,
        settingsTouched: execution.receipt?.settings?.touched === true,
    };
}

async function installSelectedProfile(baseUrl, profile) {
    const profileQuery = encodeURIComponent(profile);
    const confirmation = await postJson(`${baseUrl}/api/mod/install-confirmation?profile=${profileQuery}`);
    if (confirmation.status !== "ready_for_confirmation") {
        throw new Error(`install confirmation was ${confirmation.status}: ${confirmation.summary}`);
    }

    const execution = await postJson(`${baseUrl}/api/mod/install-execution?profile=${profileQuery}`, {
        enableExecution: true,
        acknowledgement: confirmation.confirmation?.acknowledgement ?? "",
        confirmedStagedSha256: confirmation.staged?.dllSha256 ?? "",
        confirmedDestinationPath: confirmation.target?.destinationPath ?? "",
    });
    if (execution.status !== "installed") {
        throw new Error(`install execution was ${execution.status}: ${execution.summary}`);
    }

    return {
        status: execution.status,
        profile: execution.profile,
        tag: confirmation.installPlan?.target?.tag ?? "",
        assetName: confirmation.installPlan?.target?.assetName ?? "",
        stagedSha256: confirmation.staged?.dllSha256 ?? "",
        installedSha256: execution.receipt?.destination?.dllSha256 ?? "",
        manifestPath: execution.receipt?.manifest?.path ?? "",
    };
}

async function startServer(config) {
    await runControl([
        "start",
        "--game-dir",
        config.gameDirectory,
        "--feed-path",
        path.join(config.gameDirectory, "community_patch_battle_feed.jsonl"),
        "--settings-path",
        path.join(config.gameDirectory, "community_patch_settings.toml"),
        "--port",
        String(config.port),
        "--developer-mode",
    ], {
        STFC_SIDECAR_ENABLE_MOD_UNINSTALL_EXECUTION: "1",
        STFC_SIDECAR_ENABLE_MOD_INSTALL_EXECUTION: "1",
        STFC_SIDECAR_MOD_TOKEN: config.modToken,
        STFC_SIDECAR_MOD_PROFILE: config.profile,
    });
}

async function stopServer() {
    await runControl(["stop"]);
}

function runControl(args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [controlScript, ...args], {
            cwd: repoRoot,
            env: { ...process.env, ...env },
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
        child.on("exit", (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }
            reject(new Error([stderr.trim(), stdout.trim(), `viewer-server-control exited with code ${code}`].filter(Boolean).join("\n")));
        });
    });
}

async function getJson(url) {
    const response = await fetch(url, { cache: "no-store", headers: requestHeaders() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) {
        throw new Error(body.error ? `${url}: ${body.error}` : `${url}: HTTP ${response.status}`);
    }
    return body;
}

async function postJson(url, body) {
    const response = await fetch(url, {
        cache: "no-store",
        method: "POST",
        headers: requestHeaders({ json: body !== undefined }),
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
        throw new Error(result.error ? `${url}: ${result.error}` : `${url}: HTTP ${response.status}`);
    }
    return result;
}

function requestHeaders(options = {}) {
    const headers = {
        authorization: `Bearer ${smokeConfig?.modToken ?? ""}`,
        "x-sidecar-network-consent": "github-release",
    };
    if (options.json) {
        headers["content-type"] = "application/json";
    }
    return headers;
}

async function snapshotSettingsArtifacts(gameDirectory) {
    const entries = await fs.readdir(gameDirectory, { withFileTypes: true });
    const snapshots = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().startsWith("community_patch")) {
            continue;
        }

        if (!ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            continue;
        }

        const filePath = path.join(gameDirectory, entry.name);
        const stats = await fs.stat(filePath);
        snapshots.push({
            name: entry.name,
            path: filePath,
            bytes: stats.size,
            sha256: await sha256File(filePath),
        });
    }
    snapshots.sort((left, right) => left.name.localeCompare(right.name));
    return snapshots;
}

async function changedSettingsArtifacts(snapshots) {
    const changed = [];
    for (const snapshot of snapshots) {
        if (!await fileExists(snapshot.path)) {
            changed.push({ name: snapshot.name, reason: "missing" });
            continue;
        }

        const stats = await fs.stat(snapshot.path);
        const sha256 = await sha256File(snapshot.path);
        if (stats.size !== snapshot.bytes || sha256 !== snapshot.sha256) {
            changed.push({ name: snapshot.name, reason: "changed" });
        }
    }
    return changed;
}

async function listBackupFiles(backupDirectory) {
    const entries = await fs.readdir(backupDirectory, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        if (entry.isFile()) {
            const filePath = path.join(backupDirectory, entry.name);
            const stats = await fs.stat(filePath);
            files.push({ name: entry.name, path: filePath, bytes: stats.size });
        }
    }
    return files.sort((left, right) => left.name.localeCompare(right.name));
}

async function restoreOriginalDllIfMissing(versionDllPath, originalDllCopy) {
    if (await fileExists(versionDllPath)) {
        return;
    }

    if (await fileExists(originalDllCopy)) {
        await fs.copyFile(originalDllCopy, versionDllPath);
        console.error(`[dev-smoke] restored missing version.dll from temporary copy: ${versionDllPath}`);
    }
}

async function requireFile(filePath, label) {
    if (!await fileExists(filePath)) {
        throw new Error(`${label} was not found at ${filePath}`);
    }
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const stream = createReadStream(filePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", reject);
        stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
    });
}

function smokePaths(gameDirectory) {
    return {
        primeExe: path.join(gameDirectory, "prime.exe"),
        versionDll: path.join(gameDirectory, "version.dll"),
        backupDirectory: path.join(gameDirectory, ".stfc-sidecar", "backups"),
    };
}

function parseArgs(args) {
    let gameDirectory = process.env.STFC_SIDECAR_DEV_GAME_DIR || DEFAULT_GAME_DIR;
    let port = parseInteger(process.env.STFC_SIDECAR_DEV_SMOKE_PORT, DEFAULT_PORT);
    let profile = normalizeCommunityModReleaseProfile(process.env.STFC_SIDECAR_DEV_SMOKE_PROFILE || DEFAULT_PROFILE);
    let allowNonDevGameDirectory = false;
    const modToken = process.env.STFC_SIDECAR_DEV_SMOKE_MOD_TOKEN?.trim() || randomUUID();

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const nextValue = () => {
            if (index + 1 >= args.length) {
                throw new Error(`missing value for ${arg}`);
            }
            index += 1;
            return args[index];
        };

        if (arg === "--game-dir") {
            gameDirectory = nextValue();
            continue;
        }

        if (arg === "--port") {
            port = parseInteger(nextValue(), DEFAULT_PORT);
            continue;
        }

        if (arg === "--profile") {
            profile = normalizeCommunityModReleaseProfile(nextValue());
            continue;
        }

        if (arg === "--allow-non-dev-game-dir") {
            allowNonDevGameDirectory = true;
            continue;
        }

        if (arg === "--help" || arg === "-h") {
            printUsage();
            process.exit(0);
        }

        throw new Error(`unknown argument: ${arg}`);
    }

    return { gameDirectory: path.resolve(gameDirectory), port, profile, allowNonDevGameDirectory, modToken };
}

function assertSafeDevGameDirectory(config) {
    if (config.allowNonDevGameDirectory) {
        return;
    }

    const normalized = config.gameDirectory.replaceAll("/", "\\").toLowerCase();
    if (!normalized.includes("\\games\\dev\\")) {
        throw new Error(
            `refusing to run destructive dev smoke outside a dev game path: ${config.gameDirectory}. `
            + "Pass --allow-non-dev-game-dir only for an intentional disposable target.",
        );
    }
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function printUsage() {
    console.log("Usage: node scripts/community-mod-dev-reinstall-smoke.mjs [--game-dir <dir>] [--port <port>] [--profile <netniv-basic|waffle-basic|waffle-advanced>] [--allow-non-dev-game-dir]");
    console.log(`Default game dir: ${DEFAULT_GAME_DIR}`);
    console.log(`Default port: ${DEFAULT_PORT}`);
    console.log(`Default profile: ${DEFAULT_PROFILE}`);
}

void main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});