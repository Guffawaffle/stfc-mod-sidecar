import { describe, expect, it } from "vitest";

import {
    generateLocalCapabilityToken,
    isAuthorizedModRequest,
    isAuthorizedSettingsRequest,
    isAuthorizedShutdownRequest,
    isAuthorizedSyncRequest,
    localCapabilityTokenFrom,
    resolveModToken,
    resolveSettingsToken,
    resolveSyncToken,
} from "../../viewer/local-auth.mjs";

function request(headers = {}) {
    return { headers };
}

describe("local API authorization", () => {
    it("normalizes configured capability tokens", () => {
        expect(localCapabilityTokenFrom("  token-value  ")).toBe("token-value");
        expect(localCapabilityTokenFrom("   ")).toBe("");
    });

    it("generates a sync token when the environment does not provide one", () => {
        const token = resolveSyncToken({});

        expect(token).toMatch(/^[0-9a-f-]{36}$/i);
        expect(token).not.toBe("testtoken123");
        expect(generateLocalCapabilityToken()).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("uses explicit sync and settings tokens without coupling them", () => {
        expect(resolveSyncToken({ STFC_SIDECAR_SYNC_TOKEN: " sync-secret " })).toBe("sync-secret");
        expect(resolveSettingsToken({ STFC_SIDECAR_SYNC_TOKEN: "sync-secret" })).toBe("");
        expect(resolveSettingsToken({ STFC_SIDECAR_SETTINGS_TOKEN: " settings-secret " })).toBe("settings-secret");
    });

    it("generates or uses a separate mod operation token", () => {
        expect(resolveModToken({ STFC_SIDECAR_MOD_TOKEN: " mod-secret " })).toBe("mod-secret");
        expect(resolveModToken({ STFC_SIDECAR_SYNC_TOKEN: "sync-secret" })).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it("authorizes sync requests only with the sync token", () => {
        expect(isAuthorizedSyncRequest(request({ authorization: "Bearer sync-secret" }), "sync-secret")).toBe(true);
        expect(isAuthorizedSyncRequest(request({ "stfc-sync-token": "sync-secret" }), "sync-secret")).toBe(true);
        expect(isAuthorizedSyncRequest(request({ authorization: "Bearer wrong" }), "sync-secret")).toBe(false);
        expect(isAuthorizedSyncRequest(request({ authorization: "Bearer testtoken123" }), "sync-secret")).toBe(false);
        expect(isAuthorizedSyncRequest(request({ authorization: "Bearer anything" }), "")).toBe(false);
    });

    it("allows local trusted settings saves but protects remote settings saves", () => {
        expect(isAuthorizedSettingsRequest(request(), { settingsSaveMode: "local_trusted", settingsToken: "" })).toBe(true);
        expect(isAuthorizedSettingsRequest(request(), { settingsSaveMode: "remote_protected", settingsToken: "" })).toBe(false);
        expect(isAuthorizedSettingsRequest(request({ authorization: "Bearer settings-secret" }), {
            settingsSaveMode: "remote_protected",
            settingsToken: "settings-secret",
        })).toBe(true);
        expect(isAuthorizedSettingsRequest(request({ "x-sidecar-settings-token": "settings-secret" }), {
            settingsSaveMode: "remote_protected",
            settingsToken: "settings-secret",
        })).toBe(true);
        expect(isAuthorizedSettingsRequest(request({ authorization: "Bearer sync-secret" }), {
            settingsSaveMode: "remote_protected",
            settingsToken: "settings-secret",
        })).toBe(false);
    });

    it("authorizes mod operations only with the mod token", () => {
        expect(isAuthorizedModRequest(request({ authorization: "Bearer mod-secret" }), "mod-secret")).toBe(true);
        expect(isAuthorizedModRequest(request({ "x-sidecar-mod-token": "mod-secret" }), "mod-secret")).toBe(true);
        expect(isAuthorizedModRequest(request({ authorization: "Bearer sync-secret" }), "mod-secret")).toBe(false);
        expect(isAuthorizedModRequest(request({ authorization: "Bearer anything" }), "")).toBe(false);
    });

    it("authorizes shutdown only with a configured shutdown token", () => {
        expect(isAuthorizedShutdownRequest(request({ authorization: "Bearer shutdown-secret" }), "shutdown-secret")).toBe(true);
        expect(isAuthorizedShutdownRequest(request({ "x-sidecar-shutdown-token": "shutdown-secret" }), "shutdown-secret")).toBe(true);
        expect(isAuthorizedShutdownRequest(request({ authorization: "Bearer anything" }), "")).toBe(false);
    });
});