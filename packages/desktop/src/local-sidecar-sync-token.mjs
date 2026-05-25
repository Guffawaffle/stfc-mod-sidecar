import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { localCapabilityTokenFrom } from "../../viewer/local-auth.mjs";

export const LOCAL_SIDECAR_SYNC_TARGET = "sidecar.sync";
export const LOCAL_SIDECAR_INGEST_URL = "http://127.0.0.1:43127/api/sidecar/ingest";
export const LOCAL_SIDECAR_SYNC_ENABLED = true;
export const LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED = true;
export const LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED = true;
export const COMMUNITY_PATCH_SETTINGS_FILE = "community_patch_settings.toml";

export function resolveLocalSidecarSyncToken(options = {}) {
    const env = options.env ?? process.env;
    const desktopSettings = options.desktopSettings ?? {};
    const generateToken = options.generateToken ?? randomUUID;
    const envToken = localCapabilityTokenFrom(env.STFC_SIDECAR_SYNC_TOKEN);
    if (envToken) {
        return {
            token: envToken,
            source: "environment",
            desktopSettingsPatch: null,
        };
    }

    const storedToken = localCapabilityTokenFrom(desktopSettings.localSidecarSyncToken);
    if (storedToken) {
        return {
            token: storedToken,
            source: "desktop_settings",
            desktopSettingsPatch: null,
        };
    }

    const generatedToken = localCapabilityTokenFrom(generateToken());
    if (!generatedToken) {
        throw new Error("Failed to generate local Sidecar sync token.");
    }

    return {
        token: generatedToken,
        source: "generated",
        desktopSettingsPatch: { localSidecarSyncToken: generatedToken },
    };
}

export async function prepareLocalSidecarSyncTokenForLaunch(options = {}) {
    const decision = resolveLocalSidecarSyncToken(options);
    let desktopSettings = options.desktopSettings ?? {};
    let persistedDesktopSettings = false;

    if (decision.desktopSettingsPatch) {
        desktopSettings = {
            ...desktopSettings,
            ...decision.desktopSettingsPatch,
        };
        options.setDesktopSettings?.(desktopSettings);
        options.saveDesktopSettings?.(desktopSettings);
        persistedDesktopSettings = true;
    }

    const propagation = await propagateLocalSidecarSyncTokenToProducerConfig({
        gameDirectory: options.gameDirectory,
        token: decision.token,
        fileSystem: options.fileSystem,
    });

    return {
        token: decision.token,
        source: decision.source,
        desktopSettings,
        persistedDesktopSettings,
        propagation: redactLocalSidecarSyncTokenPropagation(propagation),
    };
}

export async function propagateLocalSidecarSyncTokenToProducerConfig(options = {}) {
    const token = localCapabilityTokenFrom(options.token);
    if (!token) {
        return {
            ok: false,
            status: "skipped",
            reason: "missing_token",
            target: LOCAL_SIDECAR_SYNC_TARGET,
            settingsPath: "",
        };
    }

    const gameDirectory = String(options.gameDirectory ?? "").trim();
    if (!gameDirectory) {
        return {
            ok: false,
            status: "skipped",
            reason: "missing_game_directory",
            target: LOCAL_SIDECAR_SYNC_TARGET,
            settingsPath: "",
        };
    }

    const fileSystem = options.fileSystem ?? fs;
    const settingsPath = path.join(gameDirectory, COMMUNITY_PATCH_SETTINGS_FILE);
    let previousContents = "";
    try {
        previousContents = await fileSystem.readFile(settingsPath, "utf8");
    } catch (error) {
        return {
            ok: false,
            status: "skipped",
            reason: error?.code === "ENOENT" ? "settings_missing" : "settings_read_failed",
            target: LOCAL_SIDECAR_SYNC_TARGET,
            settingsPath,
        };
    }

    const patch = applyLocalSidecarSyncTokenToToml(previousContents, token);
    if (!patch.targetFound) {
        return {
            ok: false,
            status: "skipped",
            reason: "sidecar_target_missing",
            target: LOCAL_SIDECAR_SYNC_TARGET,
            settingsPath,
        };
    }

    if (!patch.changed) {
        return {
            ok: true,
            status: "unchanged",
            target: LOCAL_SIDECAR_SYNC_TARGET,
            settingsPath,
        };
    }

    try {
        await fileSystem.copyFile(settingsPath, `${settingsPath}.bak.sidecar`);
        await fileSystem.writeFile(settingsPath, patch.text, "utf8");
        return {
            ok: true,
            status: "updated",
            target: LOCAL_SIDECAR_SYNC_TARGET,
            settingsPath,
        };
    } catch {
        return {
            ok: false,
            status: "failed",
            reason: "settings_write_failed",
            target: LOCAL_SIDECAR_SYNC_TARGET,
            settingsPath,
        };
    }
}

export function applyLocalSidecarSyncTokenToToml(tomlText, token) {
    const normalizedToken = localCapabilityTokenFrom(token);
    if (!normalizedToken) {
        throw new Error("Local Sidecar sync token is required.");
    }

    const lines = splitLines(String(tomlText ?? ""));
    const newline = newlineForInsert(lines);
    let sectionIndex = lines.findIndex((line) => isTargetSectionLine(line.text));
    let changed = false;

    if (sectionIndex < 0) {
        if (lines.length > 0 && lines[lines.length - 1].text !== "") {
            lines.push({ text: "", newline });
        }
        sectionIndex = lines.length;
        lines.push({ text: "[sidecar.sync]", newline });
        changed = true;
    }

    let sectionEnd = findNextSectionIndex(lines, sectionIndex + 1);
    let insertionIndex = sectionIndex + 1;
    let tokenLineFound = false;
    const desiredAssignments = [
        ["enabled", LOCAL_SIDECAR_SYNC_ENABLED],
        ["url", LOCAL_SIDECAR_INGEST_URL],
        ["token", normalizedToken],
        ["battlelogs_realtime", LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED],
        ["fleet_runtime", LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED],
    ];

    for (const [key, value] of desiredAssignments) {
        const lineIndex = findAssignmentLineIndex(lines, sectionIndex + 1, sectionEnd, key);
        if (lineIndex >= 0) {
            const currentLine = lines[lineIndex];
            const replacement = replaceAssignmentValue(currentLine.text, key, value);
            if (replacement !== currentLine.text) {
                lines[lineIndex] = { text: replacement, newline: currentLine.newline };
                changed = true;
            }
            insertionIndex = lineIndex + 1;
            if (key === "token") {
                tokenLineFound = true;
            }
            continue;
        }

        lines.splice(insertionIndex, 0, { text: assignmentLine(key, value), newline });
        insertionIndex += 1;
        sectionEnd += 1;
        changed = true;
    }

    return {
        text: joinLines(lines),
        changed,
        targetFound: true,
        tokenLineFound,
    };
}

export function redactLocalSidecarSyncTokenPropagation(result = {}) {
    return {
        ok: Boolean(result.ok),
        status: result.status ?? "unknown",
        reason: result.reason,
        target: result.target ?? LOCAL_SIDECAR_SYNC_TARGET,
        settingsPath: result.settingsPath ?? "",
    };
}

function splitLines(text) {
    const matches = text.match(/.*(?:\r\n|\n|\r)|.+$/gu);
    if (!matches) {
        return [];
    }

    return matches.map((line) => {
        const newlineMatch = /(\r\n|\n|\r)$/u.exec(line);
        return {
            text: newlineMatch ? line.slice(0, -newlineMatch[0].length) : line,
            newline: newlineMatch?.[0] ?? "",
        };
    });
}

function joinLines(lines) {
    return lines.map((line) => `${line.text}${line.newline}`).join("");
}

function isTargetSectionLine(text) {
    return /^\s*\[\s*sidecar\s*\.\s*sync\s*\]\s*(?:#.*)?$/u.test(text);
}

function isAnySectionLine(text) {
    return /^\s*\[[^\]]+\]\s*(?:#.*)?$/u.test(text);
}

function findNextSectionIndex(lines, startIndex) {
    for (let index = startIndex; index < lines.length; index += 1) {
        if (isAnySectionLine(lines[index].text)) {
            return index;
        }
    }

    return lines.length;
}

function findAssignmentLineIndex(lines, startIndex, endIndex, key) {
    for (let index = startIndex; index < endIndex; index += 1) {
        if (new RegExp(`^\\s*${key}\\s*=`, "u").test(lines[index].text)) {
            return index;
        }
    }

    return -1;
}

function assignmentLine(key, value) {
    return `${key} = ${JSON.stringify(value)}`;
}

function replaceAssignmentValue(line, key, value) {
    const replacement = assignmentLine(key, value);
    const match = new RegExp(`^(\\s*${key}\\s*=\\s*)(?:\"(?:\\\\.|[^\"])*\"|'[^']*'|[^#\\r\\n]*)(\\s*(?:#.*)?)$`, "u").exec(line);
    if (!match) {
        return replacement;
    }

    return `${match[1]}${JSON.stringify(value)}${match[2]}`;
}

function newlineForInsert(lines) {
    return lines.find((line) => line.newline)?.newline ?? "\n";
}