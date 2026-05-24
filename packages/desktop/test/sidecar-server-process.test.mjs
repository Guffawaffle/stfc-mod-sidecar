import { afterEach, describe, expect, it, vi } from "vitest";

import { createSidecarServerProcess } from "../src/sidecar-server-process.mjs";

const originalFetch = globalThis.fetch;

afterEach(() => {
    vi.restoreAllMocks();
    restoreGlobal("fetch", originalFetch);
});

describe("sidecar server process", () => {
    it("reuses an existing desktop sidecar server on the requested port", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            async json() {
                return { ok: true, desktop: true };
            },
        }));

        const writeLog = vi.fn();
        const sidecarServer = createSidecarServerProcess({
            env: { STFC_SIDECAR_PORT: "43127" },
            writeLog,
        });

        await expect(sidecarServer.ensureSidecarServer()).resolves.toEqual({
            url: "http://127.0.0.1:43127",
            owned: false,
        });
        expect(writeLog).toHaveBeenCalledWith("log", "[sidecar-desktop] using existing desktop sidecar server at http://127.0.0.1:43127");
        expect(globalThis.fetch).toHaveBeenCalledWith("http://127.0.0.1:43127/api/health/ready", expect.any(Object));
    });

    it("fails when a browser-mode sidecar server already owns the requested port", async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true,
            async json() {
                return { ok: true, desktop: false };
            },
        }));

        const writeLog = vi.fn();
        const sidecarServer = createSidecarServerProcess({
            env: { STFC_SIDECAR_PORT: "43127" },
            writeLog,
        });

        await expect(sidecarServer.ensureSidecarServer()).rejects.toThrow(
            "requested sidecar port 43127 already has a browser-mode sidecar server; the desktop app will not fall back automatically. Stop the browser-mode viewer or set STFC_SIDECAR_PORT explicitly.",
        );
        expect(writeLog).toHaveBeenCalledWith(
            "error",
            "[sidecar-desktop] requested sidecar port 43127 already has a browser-mode sidecar server; the desktop app will not fall back automatically. Stop the browser-mode viewer or set STFC_SIDECAR_PORT explicitly.",
        );
        expect(globalThis.fetch).toHaveBeenCalledWith("http://127.0.0.1:43127/api/health/ready", expect.any(Object));
    });
});

function restoreGlobal(name, value) {
    if (typeof value === "undefined") {
        delete globalThis[name];
        return;
    }

    globalThis[name] = value;
}