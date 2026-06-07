import {
    DEFAULT_LOG_LINES,
    cycleManagedDesktopDev,
    readDesktopDevLogsSnapshot,
    readDesktopDevStatusSnapshot,
    startManagedDesktopDev,
    stopManagedDesktopDev,
} from "./desktop-dev.mjs";

const DESKTOP_LIFECYCLE_PROTOCOL_VERSION = "stfc.sidecar.desktop-lifecycle.ax.v1";
const DESKTOP_ACTIONS = new Set(["start", "cycle", "stop", "status", "logs"]);

export function parseDesktopLifecycleAxArgs(argv = []) {
    const parsed = {
        action: "status",
        lines: DEFAULT_LOG_LINES,
        skipStop: false,
        launchArgs: [],
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = String(argv[index] ?? "");
        switch (arg) {
            case "--action":
                if (index + 1 >= argv.length) {
                    throw new Error("Missing value for --action");
                }
                parsed.action = normalizeDesktopAction(argv[index + 1]);
                index += 1;
                break;
            case "--lines":
                if (index + 1 >= argv.length) {
                    throw new Error("Missing value for --lines");
                }
                parsed.lines = normalizePositiveInteger(argv[index + 1], DEFAULT_LOG_LINES, 500);
                index += 1;
                break;
            case "--skip-stop":
                parsed.skipStop = true;
                break;
            case "--launch-arg":
                if (index + 1 >= argv.length) {
                    throw new Error("Missing value for --launch-arg");
                }
                parsed.launchArgs.push(String(argv[index + 1] ?? ""));
                index += 1;
                break;
            default:
                throw new Error(`Unknown desktop lifecycle option: ${arg}`);
        }
    }

    return parsed;
}

export async function desktopLifecycleCommand(argv = []) {
    let options = null;
    try {
        options = parseDesktopLifecycleAxArgs(argv);
        const payload = await runDesktopLifecycleAction(options);
        return payload.ok === false
            ? { success: false, errors: [payload.error ?? "Desktop lifecycle action failed"], data: payload }
            : { success: true, data: payload };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            errors: [message],
            data: {
                ok: false,
                protocolVersion: DESKTOP_LIFECYCLE_PROTOCOL_VERSION,
                detail: "desktop-lifecycle",
                action: options?.action ?? null,
                generatedAt: new Date().toISOString(),
                error: message,
            },
        };
    }
}

export async function runDesktopLifecycleAction(options = {}) {
    const action = normalizeDesktopAction(options.action ?? "status");
    const basePayload = {
        ok: true,
        protocolVersion: DESKTOP_LIFECYCLE_PROTOCOL_VERSION,
        detail: "desktop-lifecycle",
        action,
        generatedAt: new Date().toISOString(),
    };

    switch (action) {
        case "start":
            return {
                ...basePayload,
                result: await startManagedDesktopDev({
                    skipStop: Boolean(options.skipStop),
                    launchArgs: Array.isArray(options.launchArgs) ? options.launchArgs : [],
                }),
            };
        case "cycle":
            return {
                ...basePayload,
                result: await cycleManagedDesktopDev({
                    skipStop: Boolean(options.skipStop),
                    launchArgs: Array.isArray(options.launchArgs) ? options.launchArgs : [],
                }),
            };
        case "stop":
            return {
                ...basePayload,
                result: await stopManagedDesktopDev(),
            };
        case "logs":
            return {
                ...basePayload,
                result: await readDesktopDevLogsSnapshot(options.lines ?? DEFAULT_LOG_LINES),
            };
        default:
            return {
                ...basePayload,
                result: await readDesktopDevStatusSnapshot(),
            };
    }
}

function normalizeDesktopAction(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!DESKTOP_ACTIONS.has(normalized)) {
        throw new Error(`Unsupported desktop lifecycle action: ${value}`);
    }
    return normalized;
}

function normalizePositiveInteger(value, fallback, max) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    const normalized = Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
    return Math.min(Math.max(normalized, 1), max);
}
