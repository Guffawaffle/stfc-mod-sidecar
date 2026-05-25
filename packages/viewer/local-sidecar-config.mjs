import { readFile } from "node:fs/promises";
import path from "node:path";

import { COMMUNITY_MOD_MANIFEST_DIRECTORY } from "./community-mod-install.mjs";
import { normalizeCommunityModProfile } from "./community-mod-profiles.mjs";

export const LOCAL_SIDECAR_CONFIG_FILE = "sidecar-local-config.json";

export function localSidecarConfigPath(gameDirectory) {
    const normalizedGameDirectory = typeof gameDirectory === "string" ? gameDirectory.trim() : "";
    if (!normalizedGameDirectory) {
        return "";
    }

    return path.join(normalizedGameDirectory, COMMUNITY_MOD_MANIFEST_DIRECTORY, LOCAL_SIDECAR_CONFIG_FILE);
}

export async function readLocalSidecarConfig(gameDirectory) {
    const configPath = localSidecarConfigPath(gameDirectory);
    if (!configPath) {
        return defaultLocalSidecarConfig({ path: "" });
    }

    let text = "";
    try {
        text = await readFile(configPath, "utf8");
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return defaultLocalSidecarConfig({ path: configPath });
        }

        return {
            ok: false,
            exists: false,
            path: configPath,
            error: error instanceof Error ? error.message : String(error),
            unsafeAllowUnrecognizedInstalledDll: false,
            recognizedInstalledDlls: [],
        };
    }

    try {
        const parsed = JSON.parse(text);
        return {
            ok: true,
            exists: true,
            path: configPath,
            unsafeAllowUnrecognizedInstalledDll: parsed?.unsafeAllowUnrecognizedInstalledDll === true,
            recognizedInstalledDlls: normalizeRecognizedInstalledDlls(parsed?.recognizedInstalledDlls),
        };
    } catch (error) {
        return {
            ok: false,
            exists: true,
            path: configPath,
            error: error instanceof Error ? error.message : String(error),
            unsafeAllowUnrecognizedInstalledDll: false,
            recognizedInstalledDlls: [],
        };
    }
}

function defaultLocalSidecarConfig(overrides = {}) {
    return {
        ok: true,
        exists: false,
        path: overrides.path ?? "",
        unsafeAllowUnrecognizedInstalledDll: false,
        recognizedInstalledDlls: [],
    };
}

function normalizeRecognizedInstalledDlls(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(normalizeRecognizedInstalledDll)
        .filter(Boolean);
}

function normalizeRecognizedInstalledDll(value) {
    if (!isRecord(value)) {
        return null;
    }

    const profile = normalizeKnownProfile(value.profile);
    const dllSha256 = normalizeSha256(value.dllSha256 ?? value.sha256);
    if (!profile || !dllSha256) {
        return null;
    }

    return {
        profile,
        dllSha256,
        label: typeof value.label === "string" ? value.label.trim() : "",
    };
}

function normalizeSha256(value) {
    const normalized = String(value ?? "").trim().replace(/^sha256:/i, "").toUpperCase();
    return /^[0-9A-F]{64}$/u.test(normalized) ? normalized : "";
}

function normalizeKnownProfile(value) {
    const literal = String(value ?? "").trim().toLowerCase();
    if (!literal || literal === "none" || literal === "unknown") {
        return null;
    }

    return normalizeCommunityModProfile(value, { fallback: null });
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}