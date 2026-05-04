const DEFAULT_VERSION = "0.0.0-dev";

export function buildReleaseInfo(options = {}) {
    const version = normalizeVersion(options.version);
    const channel = normalizeReleaseChannel(options.channel) ?? inferReleaseChannel(version);
    const updateMode = normalizeUpdateMode(options.updateMode);
    const signaturePolicy = normalizeSignaturePolicy(options.signaturePolicy, { packaged: options.packaged });

    return {
        version,
        channel,
        channelLabel: releaseChannelLabel(channel),
        updateMode,
        updateLabel: updateModeLabel(updateMode),
        signaturePolicy,
        signatureLabel: signaturePolicyLabel(signaturePolicy),
        signedRelease: signaturePolicy !== "local_unsigned",
    };
}

export function inferReleaseChannel(version) {
    const normalized = String(version ?? "").trim().toLowerCase();
    if (!normalized || normalized.endsWith("-dev")) {
        return "development";
    }

    if (normalized.includes("alpha")) {
        return "alpha";
    }

    if (normalized.includes("beta") || normalized.includes("rc")) {
        return "preview";
    }

    return /^\d+\.\d+\.\d+$/.test(normalized) ? "stable" : "development";
}

export function normalizeReleaseChannel(value) {
    const channel = normalizeToken(value);
    if (!channel) {
        return null;
    }

    if (["prod", "production", "release", "stable"].includes(channel)) {
        return "stable";
    }

    if (["alpha", "prerelease", "pre_release"].includes(channel)) {
        return "alpha";
    }

    if (["beta", "preview", "rc"].includes(channel)) {
        return "preview";
    }

    if (["dev", "development", "local"].includes(channel)) {
        return "development";
    }

    return channel;
}

export function normalizeSignaturePolicy(value, options = {}) {
    const policy = normalizeToken(value);
    if (!policy) {
        return options.packaged ? "authenticode_required" : "local_unsigned";
    }

    if (["unsigned", "local", "local_unsigned", "dev_unsigned"].includes(policy)) {
        return "local_unsigned";
    }

    if (["azure", "azure_trusted_signing", "trusted_signing", "signed", "authenticode", "authenticode_required"].includes(policy)) {
        return "authenticode_required";
    }

    if (["verified", "authenticode_verified"].includes(policy)) {
        return "authenticode_verified";
    }

    return policy;
}

function normalizeVersion(value) {
    const version = String(value ?? "").trim();
    return version || DEFAULT_VERSION;
}

function normalizeUpdateMode(value) {
    const mode = normalizeToken(value);
    if (!mode) {
        return "manual";
    }

    if (["none", "disabled", "off"].includes(mode)) {
        return "disabled";
    }

    if (["auto", "automatic", "autoupdate", "auto_update"].includes(mode)) {
        return "automatic";
    }

    return "manual";
}

function releaseChannelLabel(channel) {
    if (channel === "stable") {
        return "Stable";
    }

    if (channel === "alpha") {
        return "Alpha";
    }

    if (channel === "preview") {
        return "Preview";
    }

    if (channel === "development") {
        return "Development";
    }

    return titleCase(channel);
}

function updateModeLabel(mode) {
    if (mode === "automatic") {
        return "Automatic updates";
    }

    if (mode === "disabled") {
        return "Update checks disabled";
    }

    return "Manual update checks";
}

function signaturePolicyLabel(policy) {
    if (policy === "local_unsigned") {
        return "Local/dev build: unsigned artifacts are expected";
    }

    if (policy === "authenticode_verified") {
        return "Authenticode signature verified by release workflow";
    }

    if (policy === "authenticode_required") {
        return "Release artifacts must be Authenticode signed";
    }

    return titleCase(policy);
}

function normalizeToken(value) {
    return String(value ?? "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
}