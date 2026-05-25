import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
    applyLocalSidecarSyncTokenToToml,
    LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED,
    LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED,
    LOCAL_SIDECAR_INGEST_URL,
    LOCAL_SIDECAR_SYNC_ENABLED,
    prepareLocalSidecarSyncTokenForLaunch,
    propagateLocalSidecarSyncTokenToProducerConfig,
    resolveLocalSidecarSyncToken,
} from "../src/local-sidecar-sync-token.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");

describe("local Sidecar sync token", () => {
    it("uses an explicit environment token without rotating or persisting", () => {
        const decision = resolveLocalSidecarSyncToken({
            env: { STFC_SIDECAR_SYNC_TOKEN: " env-token " },
            desktopSettings: { localSidecarSyncToken: "stored-token" },
            generateToken: () => "generated-token",
        });

        expect(decision).toEqual({
            token: "env-token",
            source: "environment",
            desktopSettingsPatch: null,
        });
    });

    it("uses the persisted desktop token when the environment is unset", () => {
        const decision = resolveLocalSidecarSyncToken({
            env: {},
            desktopSettings: { localSidecarSyncToken: " stored-token " },
            generateToken: () => "generated-token",
        });

        expect(decision).toEqual({
            token: "stored-token",
            source: "desktop_settings",
            desktopSettingsPatch: null,
        });
    });

    it("generates and owns one desktop token when no source exists", () => {
        const decision = resolveLocalSidecarSyncToken({
            env: {},
            desktopSettings: {},
            generateToken: () => "generated-token",
        });

        expect(decision).toEqual({
            token: "generated-token",
            source: "generated",
            desktopSettingsPatch: { localSidecarSyncToken: "generated-token" },
        });
    });

    it("updates only the active local sidecar target token", () => {
        const original = [
            "# [sidecar.sync]",
            "# token = \"commented-token\"",
            "[sidecar.sync]",
            "enabled = false",
            "url = \"http://127.0.0.1:43127/api/events\"",
            "token = \"old-local-token\" # local producer token",
            "battlelogs_realtime = false",
            "fleet_runtime = false",
            "",
            "[sync.targets.majel]",
            "token = \"majel-token\"",
            "url = \"https://majel.example.test/api/ingest/events\"",
            "",
        ].join("\n");

        const result = applyLocalSidecarSyncTokenToToml(original, "new-local-token");

        expect(result.changed).toBe(true);
        expect(result.targetFound).toBe(true);
        expect(result.text).toContain(`enabled = ${JSON.stringify(LOCAL_SIDECAR_SYNC_ENABLED)}`);
        expect(result.text).toContain("token = \"new-local-token\" # local producer token");
        expect(result.text).toContain(`url = ${JSON.stringify(LOCAL_SIDECAR_INGEST_URL)}`);
        expect(result.text).toContain(`battlelogs_realtime = ${JSON.stringify(LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED)}`);
        expect(result.text).toContain(`fleet_runtime = ${JSON.stringify(LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED)}`);
        expect(result.text).toContain("token = \"majel-token\"");
        expect(result.text).toContain("# token = \"commented-token\"");
    });

    it("inserts a token into an existing sidecar target without creating other targets", () => {
        const result = applyLocalSidecarSyncTokenToToml("[sidecar.sync]\nurl = \"http://127.0.0.1:43127/api/events\"\n", "new-local-token");

        expect(result.changed).toBe(true);
        expect(result.text).toBe(
            `[sidecar.sync]\n`
            + `enabled = ${JSON.stringify(LOCAL_SIDECAR_SYNC_ENABLED)}\n`
            + `url = ${JSON.stringify(LOCAL_SIDECAR_INGEST_URL)}\n`
            + `token = \"new-local-token\"\n`
            + `battlelogs_realtime = ${JSON.stringify(LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED)}\n`
            + `fleet_runtime = ${JSON.stringify(LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED)}\n`,
        );
    });

    it("creates the canonical sidecar target when the producer config has none", () => {
        const result = applyLocalSidecarSyncTokenToToml("[sync.targets.majel]\ntoken = \"remote-token\"\n", "new-local-token");

        expect(result).toMatchObject({ changed: true, targetFound: true, tokenLineFound: false });
        expect(result.text).toContain("[sync.targets.majel]\ntoken = \"remote-token\"\n");
        expect(result.text).toContain("[sidecar.sync]");
        expect(result.text).toContain(`enabled = ${JSON.stringify(LOCAL_SIDECAR_SYNC_ENABLED)}`);
        expect(result.text).toContain(`url = ${JSON.stringify(LOCAL_SIDECAR_INGEST_URL)}`);
        expect(result.text).toContain("token = \"new-local-token\"");
        expect(result.text).toContain(`battlelogs_realtime = ${JSON.stringify(LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED)}`);
        expect(result.text).toContain(`fleet_runtime = ${JSON.stringify(LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED)}`);
    });

    it("propagates the launch token to producer config without returning the token in status", async () => {
        const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-token-"));
        try {
            const settingsPath = path.join(gameDirectory, "community_patch_settings.toml");
            await fs.writeFile(settingsPath, "[sidecar.sync]\ntoken = \"old-token\"\nurl = \"http://127.0.0.1:43127/api/events\"\n", "utf8");

            const result = await propagateLocalSidecarSyncTokenToProducerConfig({
                gameDirectory,
                token: "new-local-token",
            });

            expect(result).toMatchObject({ ok: true, status: "updated", target: "sidecar.sync" });
            expect(JSON.stringify(result)).not.toContain("new-local-token");
            expect(await fs.readFile(settingsPath, "utf8")).toContain("token = \"new-local-token\"");
            expect(await fs.readFile(settingsPath, "utf8")).toContain(`enabled = ${JSON.stringify(LOCAL_SIDECAR_SYNC_ENABLED)}`);
            expect(await fs.readFile(settingsPath, "utf8")).toContain(`battlelogs_realtime = ${JSON.stringify(LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED)}`);
            expect(await fs.readFile(settingsPath, "utf8")).toContain(`fleet_runtime = ${JSON.stringify(LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED)}`);
            await expect(fs.readFile(`${settingsPath}.bak.sidecar`, "utf8")).resolves.toContain("token = \"old-token\"");
        } finally {
            await fs.rm(gameDirectory, { recursive: true, force: true });
        }
    });

    it("creates the canonical sidecar target in an existing producer config when missing", async () => {
        const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-create-token-"));
        try {
            const settingsPath = path.join(gameDirectory, "community_patch_settings.toml");
            await fs.writeFile(settingsPath, "[sync.targets.majel]\ntoken = \"remote-token\"\n", "utf8");

            const result = await propagateLocalSidecarSyncTokenToProducerConfig({
                gameDirectory,
                token: "new-local-token",
            });

            expect(result).toMatchObject({ ok: true, status: "updated", target: "sidecar.sync" });
            const text = await fs.readFile(settingsPath, "utf8");
            expect(text).toContain("[sync.targets.majel]\ntoken = \"remote-token\"\n");
            expect(text).toContain("[sidecar.sync]");
            expect(text).toContain(`enabled = ${JSON.stringify(LOCAL_SIDECAR_SYNC_ENABLED)}`);
            expect(text).toContain(`url = ${JSON.stringify(LOCAL_SIDECAR_INGEST_URL)}`);
            expect(text).toContain("token = \"new-local-token\"");
            expect(text).toContain(`battlelogs_realtime = ${JSON.stringify(LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED)}`);
            expect(text).toContain(`fleet_runtime = ${JSON.stringify(LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED)}`);
        } finally {
            await fs.rm(gameDirectory, { recursive: true, force: true });
        }
    });

    it("uses the same desktop-owned token for server launch and producer config propagation", async () => {
        const gameDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "stfc-sidecar-launch-token-"));
        const saveDesktopSettings = vi.fn();
        const setDesktopSettings = vi.fn();
        try {
            const settingsPath = path.join(gameDirectory, "community_patch_settings.toml");
            await fs.writeFile(settingsPath, "[sidecar.sync]\ntoken = \"old-token\"\nurl = \"http://127.0.0.1:43127/api/events\"\n", "utf8");

            const launch = await prepareLocalSidecarSyncTokenForLaunch({
                env: {},
                desktopSettings: { modProfile: "netniv-basic" },
                gameDirectory,
                generateToken: () => "generated-local-token",
                saveDesktopSettings,
                setDesktopSettings,
            });

            expect(launch.token).toBe("generated-local-token");
            expect(launch.source).toBe("generated");
            expect(launch.persistedDesktopSettings).toBe(true);
            expect(saveDesktopSettings).toHaveBeenCalledWith(expect.objectContaining({ localSidecarSyncToken: "generated-local-token" }));
            expect(setDesktopSettings).toHaveBeenCalledWith(expect.objectContaining({ localSidecarSyncToken: "generated-local-token" }));
            const text = await fs.readFile(settingsPath, "utf8");
            expect(text).toContain("token = \"generated-local-token\"");
            expect(text).toContain(`enabled = ${JSON.stringify(LOCAL_SIDECAR_SYNC_ENABLED)}`);
            expect(text).toContain(`battlelogs_realtime = ${JSON.stringify(LOCAL_SIDECAR_BATTLELOGS_REALTIME_ENABLED)}`);
            expect(text).toContain(`fleet_runtime = ${JSON.stringify(LOCAL_SIDECAR_FLEET_RUNTIME_ENABLED)}`);
            expect(JSON.stringify(launch.propagation)).not.toContain("generated-local-token");
        } finally {
            await fs.rm(gameDirectory, { recursive: true, force: true });
        }
    });

    it("keeps Fleet and Majel ingest on the shared local sync auth helper", () => {
        const serverSource = readFileSync(path.join(repositoryRoot, "packages/viewer/server.mjs"), "utf8");

        expect(serverSource).toMatch(/async function handleFleetSyncIngest[\s\S]*?!isAuthorizedSyncRequest\(request\)/u);
        expect(serverSource).toMatch(/async function handleSidecarIngest[\s\S]*?!isAuthorizedSyncRequest\(request\)/u);
        expect(serverSource).toMatch(/async function handleMajelIngest[\s\S]*?!isAuthorizedSyncRequest\(request\)/u);
    });

    it("does not expose the local sync token through bootstrap source", () => {
        const mainSource = readFileSync(path.join(repositoryRoot, "packages/desktop/src/main.mjs"), "utf8");
        const bootstrapBody = /async function bootstrapSnapshot[\s\S]*?\n\}\n\nfunction resolveSelectedGamePaths/u.exec(mainSource)?.[0] ?? "";

        expect(bootstrapBody).not.toContain("localSidecarSyncToken");
        expect(bootstrapBody).not.toContain("sidecarSyncToken");
    });
});