import { randomUUID } from "node:crypto";

export function generateLocalCapabilityToken() {
    return randomUUID();
}

export function localCapabilityTokenFrom(value) {
    return String(value ?? "").trim();
}

export function resolveSyncToken(env = process.env) {
    return localCapabilityTokenFrom(env.STFC_SIDECAR_SYNC_TOKEN) || generateLocalCapabilityToken();
}

export function resolveSettingsToken(env = process.env) {
    return localCapabilityTokenFrom(env.STFC_SIDECAR_SETTINGS_TOKEN);
}

export function resolveModToken(env = process.env) {
    return localCapabilityTokenFrom(env.STFC_SIDECAR_MOD_TOKEN) || generateLocalCapabilityToken();
}

export function isAuthorizedSyncRequest(request, syncToken) {
    return isAuthorizedTokenRequest(request, syncToken, "stfc-sync-token");
}

export function isAuthorizedSettingsRequest(request, options = {}) {
    if (options.settingsSaveMode !== "remote_protected") {
        return true;
    }

    return isAuthorizedTokenRequest(request, options.settingsToken, "x-sidecar-settings-token");
}

export function isAuthorizedModRequest(request, modToken) {
    return isAuthorizedTokenRequest(request, modToken, "x-sidecar-mod-token");
}

export function isAuthorizedShutdownRequest(request, shutdownToken) {
    return isAuthorizedTokenRequest(request, shutdownToken, "x-sidecar-shutdown-token");
}

function isAuthorizedTokenRequest(request, token, headerName) {
    const expectedToken = localCapabilityTokenFrom(token);
    if (!expectedToken) {
        return false;
    }

    const headers = request?.headers ?? {};
    const authorization = headerValue(headers.authorization);
    if (authorization === `Bearer ${expectedToken}`) {
        return true;
    }

    return headerValue(headers[headerName]) === expectedToken;
}

function headerValue(value) {
    if (Array.isArray(value)) {
        return value[0] ?? "";
    }

    return String(value ?? "");
}