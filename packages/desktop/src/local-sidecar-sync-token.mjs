import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { localCapabilityTokenFrom } from "../../viewer/local-auth.mjs";

export const LOCAL_SIDECAR_SYNC_TARGET = "sync.targets.sidecar";
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
    const sectionIndex = lines.findIndex((line) => isTargetSectionLine(line.text));
    if (sectionIndex < 0) {
        return {
            text: String(tomlText ?? ""),
            changed: false,
            targetFound: false,
            tokenLineFound: false,
        };
    }

    const nextSectionIndex = findNextSectionIndex(lines, sectionIndex + 1);
    const tokenLineIndex = findTokenLineIndex(lines, sectionIndex + 1, nextSectionIndex);
    const nextTokenLine = tokenAssignmentLine(normalizedToken);

    if (tokenLineIndex >= 0) {
        const currentLine = lines[tokenLineIndex];
        const replacement = replaceTokenValue(currentLine.text, normalizedToken);
        if (replacement === currentLine.text) {
            return {
                text: String(tomlText ?? ""),
                changed: false,
                targetFound: true,
                tokenLineFound: true,
            };
        }

        lines[tokenLineIndex] = { text: replacement, newline: currentLine.newline };
        return {
            text: joinLines(lines),
            changed: true,
            targetFound: true,
            tokenLineFound: true,
        };
    }

    lines.splice(sectionIndex + 1, 0, { text: nextTokenLine, newline: newlineForInsert(lines) });
    return {
        text: joinLines(lines),
        changed: true,
        targetFound: true,
        tokenLineFound: false,
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
    return /^\s*\[\s*sync\s*\.\s*targets\s*\.\s*sidecar\s*\]\s*(?:#.*)?$/u.test(text);
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

function findTokenLineIndex(lines, startIndex, endIndex) {
    for (let index = startIndex; index < endIndex; index += 1) {
        if (/^\s*token\s*=/u.test(lines[index].text)) {
            return index;
        }
    }

    return -1;
}

function tokenAssignmentLine(token) {
    return `token = ${JSON.stringify(token)}`;
}

function replaceTokenValue(line, token) {
    const replacement = tokenAssignmentLine(token);
    const match = /^(\s*token\s*=\s*)(?:"(?:\\.|[^"])*"|'[^']*'|[^#\r\n]*)(\s*(?:#.*)?)$/u.exec(line);
    if (!match) {
        return replacement;
    }

    return `${match[1]}${JSON.stringify(token)}${match[2]}`;
}

function newlineForInsert(lines) {
    return lines.find((line) => line.newline)?.newline ?? "\n";
}