import { readFile } from "node:fs/promises";
import path from "node:path";

import { COMMUNITY_MOD_MANIFEST_DIRECTORY } from "./community-mod-install.mjs";

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
        };
    }

    try {
        const parsed = JSON.parse(text);
        return {
            ok: true,
            exists: true,
            path: configPath,
            unsafeAllowUnrecognizedInstalledDll: parsed?.unsafeAllowUnrecognizedInstalledDll === true,
        };
    } catch (error) {
        return {
            ok: false,
            exists: true,
            path: configPath,
            error: error instanceof Error ? error.message : String(error),
            unsafeAllowUnrecognizedInstalledDll: false,
        };
    }
}

function defaultLocalSidecarConfig(overrides = {}) {
    return {
        ok: true,
        exists: false,
        path: overrides.path ?? "",
        unsafeAllowUnrecognizedInstalledDll: false,
    };
}