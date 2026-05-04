export const DIAGNOSTICS_BUNDLE_SCHEMA_VERSION = 1;

const SECRET_PATTERN = /(token|secret|password|authorization|credential|api[_-]?key)/i;

export function buildDiagnosticsBundle(input = {}) {
    const generatedAt = input.generatedAt ?? new Date().toISOString();
    const feed = input.feed ?? {};
    const settings = input.settings ?? {};
    const release = input.release ?? {};

    return {
        ok: true,
        kind: "stfc-sidecar-diagnostics",
        schemaVersion: DIAGNOSTICS_BUNDLE_SCHEMA_VERSION,
        generatedAt,
        privacy: {
            redacted: true,
            localPaths: "Only file or directory names are included by default.",
            secrets: "Tokens, credentials, and authorization values are omitted.",
        },
        app: {
            version: release.version ?? "unknown",
            channel: release.channel ?? "unknown",
            updateMode: release.updateMode ?? "unknown",
            signaturePolicy: release.signaturePolicy ?? "unknown",
        },
        runtime: {
            developerMode: Boolean(input.developerMode),
            companionMode: input.companionMode ?? "standard",
            serverPid: input.pid ?? null,
            port: input.port ?? null,
            startedAt: input.startedAt ?? null,
            uptimeMs: input.uptimeMs ?? null,
            eventStoreBackend: input.eventStoreBackend ?? "none",
        },
        paths: {
            gameDirectory: redactPath(input.gameDir),
            feedPath: redactPath(input.feedPath),
            settingsPath: redactPath(input.settingsPath),
        },
        feed: {
            source: feed.source ?? "unknown",
            exists: Boolean(feed.exists),
            storageBackend: feed.storageBackend ?? input.eventStoreBackend ?? "none",
            totalLines: finiteNumberOrNull(feed.totalLines),
            returnedLines: finiteNumberOrNull(feed.returnedLines),
            lastModified: feed.lastModified ?? null,
            pollHintMs: finiteNumberOrNull(feed.pollHintMs),
            error: feed.error ? redactSensitiveText(feed.error) : null,
        },
        settings: {
            exists: Boolean(settings.exists),
            parseError: Boolean(settings.parseError),
            saveSupported: Boolean(settings.saveSupported),
            settingsSaveMode: settings.settingsSaveMode ?? "unknown",
            actionCount: Array.isArray(settings.actions) ? settings.actions.length : null,
            hardSettingCount: Array.isArray(settings.hardSettings) ? settings.hardSettings.length : null,
            warningCount: countSettingsWarnings(settings),
        },
        prompt: buildTroubleshootingPrompt({ generatedAt, release, feed, settings, input }),
    };
}

export function buildDiagnosticsMarkdown(bundle) {
    return [
        "# STFC Sidecar Diagnostics",
        "",
        `Generated: ${bundle.generatedAt}`,
        "",
        "## App",
        "",
        `- Version: ${bundle.app.version}`,
        `- Channel: ${bundle.app.channel}`,
        `- Update mode: ${bundle.app.updateMode}`,
        `- Signature policy: ${bundle.app.signaturePolicy}`,
        "",
        "## Runtime",
        "",
        `- Mode: ${bundle.runtime.companionMode}`,
        `- Developer Tools: ${bundle.runtime.developerMode ? "enabled" : "disabled"}`,
        `- Event store: ${bundle.runtime.eventStoreBackend}`,
        `- Uptime ms: ${bundle.runtime.uptimeMs ?? "unknown"}`,
        "",
        "## Paths",
        "",
        `- Game directory: ${formatRedactedPath(bundle.paths.gameDirectory)}`,
        `- Feed path: ${formatRedactedPath(bundle.paths.feedPath)}`,
        `- Settings path: ${formatRedactedPath(bundle.paths.settingsPath)}`,
        "",
        "## Feed",
        "",
        `- Source: ${bundle.feed.source}`,
        `- Exists: ${bundle.feed.exists}`,
        `- Total lines: ${bundle.feed.totalLines ?? "unknown"}`,
        `- Returned lines: ${bundle.feed.returnedLines ?? "unknown"}`,
        `- Last modified: ${bundle.feed.lastModified ?? "unknown"}`,
        bundle.feed.error ? `- Error: ${bundle.feed.error}` : "- Error: none",
        "",
        "## Settings",
        "",
        `- Exists: ${bundle.settings.exists}`,
        `- Parse error: ${bundle.settings.parseError}`,
        `- Save mode: ${bundle.settings.settingsSaveMode}`,
        `- Actions: ${bundle.settings.actionCount ?? "unknown"}`,
        `- Hard settings: ${bundle.settings.hardSettingCount ?? "unknown"}`,
        `- Warnings: ${bundle.settings.warningCount}`,
        "",
        "## Prompt",
        "",
        bundle.prompt,
        "",
    ].join("\n");
}

export function redactPath(value) {
    const text = String(value ?? "").trim();
    if (!text) {
        return {
            present: false,
            name: "",
        };
    }

    const normalized = text.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    const name = parts.at(-1) ?? "";

    return {
        present: true,
        name: redactSensitiveText(name),
        redacted: parts.length > 1 ? `<redacted>/${redactSensitiveText(name)}` : redactSensitiveText(name),
    };
}

export function redactSensitiveText(value) {
    const text = String(value ?? "");
    if (!text) {
        return "";
    }

    return text
        .replace(/Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi, "Bearer <redacted>")
        .replace(/([?&](?:token|secret|password|api[_-]?key)=)[^&\s]+/gi, "$1<redacted>")
        .replace(/\b(?:token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;&]+/gi, (match) => {
            const separator = match.includes(":") ? ":" : "=";
            return `${match.split(separator)[0]}${separator}<redacted>`;
        });
}

function buildTroubleshootingPrompt({ generatedAt, release, feed, settings, input }) {
    const lines = [
        "Use this redacted STFC Sidecar diagnostics summary to help troubleshoot the user's issue.",
        "Do not assume omitted local paths, tokens, or credentials are available.",
        `Generated at: ${generatedAt}`,
        `Version: ${release.version ?? "unknown"}`,
        `Mode: ${input.companionMode ?? "standard"}`,
        `Feed exists: ${Boolean(feed.exists)}`,
        `Settings exists: ${Boolean(settings.exists)}`,
    ];

    if (feed.error) {
        lines.push(`Feed error: ${redactSensitiveText(feed.error)}`);
    }

    if (settings.parseError) {
        lines.push("Settings parse error: true");
    }

    return lines.join("\n");
}

function countSettingsWarnings(settings) {
    const actionWarnings = Array.isArray(settings.actions)
        ? settings.actions.reduce((count, action) => count + countIssues(action), 0)
        : 0;
    const hardSettingWarnings = Array.isArray(settings.hardSettings)
        ? settings.hardSettings.reduce((count, setting) => count + countIssues(setting), 0)
        : 0;
    return actionWarnings + hardSettingWarnings;
}

function countIssues(item) {
    return Array.isArray(item?.issues) ? item.issues.filter((issue) => issue?.severity !== "info").length : 0;
}

function finiteNumberOrNull(value) {
    return Number.isFinite(value) ? value : null;
}

function formatRedactedPath(value) {
    if (!value?.present) {
        return "not set";
    }

    return value.redacted ?? value.name;
}

export function omitSensitiveKeys(value) {
    if (Array.isArray(value)) {
        return value.map(omitSensitiveKeys);
    }

    if (typeof value !== "object" || value === null) {
        return typeof value === "string" ? redactSensitiveText(value) : value;
    }

    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !SECRET_PATTERN.test(key))
        .map(([key, item]) => [key, omitSensitiveKeys(item)]));
}