import { describe, expect, it, vi } from "vitest";

import { registerDesktopIpc } from "../src/desktop-ipc.mjs";

describe("desktop IPC registration", () => {
    it("registers the desktop bridge channel names used by preload", () => {
        const handles = registerWithSettings({ developerMode: false });

        expect([...handles.keys()]).toEqual([
            "sidecar-bootstrap:get",
            "sidecar-companion-uninstall:get-status",
            "sidecar-companion-uninstall:open-windows-settings",
            "sidecar-companion-uninstall:show-install-folder",
            "sidecar-companion-uninstall:run",
            "sidecar-bootstrap:set-developer-mode",
            "sidecar-bootstrap:set-mod-profile",
            "sidecar-devtools:get-status",
            "sidecar-bootstrap:select-game-directory",
            "sidecar-bootstrap:open-game-directory",
        ]);
    });

    it("keeps Developer Tools status gated by desktop settings", () => {
        const disabledHandles = registerWithSettings({ developerMode: false });
        expect(disabledHandles.get("sidecar-devtools:get-status")()).toEqual({
            ok: false,
            code: "developer_mode_required",
            error: "Developer Tools are disabled.",
            developerMode: false,
            companionMode: "standard",
        });

        const enabledHandles = registerWithSettings({ developerMode: true });
        expect(enabledHandles.get("sidecar-devtools:get-status")()).toEqual({
            ok: true,
            developerMode: true,
            companionMode: "developer",
        });
    });
});

function registerWithSettings(settings) {
    const handles = new Map();
    registerDesktopIpc({
        app: {
            getName: () => "STFC Community Mod Companion",
            getPath: () => "",
            isPackaged: false,
        },
        bootstrapSnapshot: vi.fn(),
        dialog: {
            showOpenDialog: vi.fn(),
        },
        getDesktopSettings: () => ({
            gameDirectory: "",
            modProfile: "netniv-basic",
            profileGameDirectories: {},
            ...settings,
        }),
        getMainWindow: () => null,
        ipcMain: {
            handle: (channel, handler) => handles.set(channel, handler),
        },
        process: {
            env: {},
            execPath: "",
            platform: "win32",
        },
        restartSidecarServer: vi.fn(),
        saveDesktopSettings: vi.fn(),
        setBootstrapWarning: vi.fn(),
        setDesktopSettings: vi.fn(),
        shell: {
            openExternal: vi.fn(),
            openPath: vi.fn(),
        },
        validateStfcGameDirectory: vi.fn(),
        writeLog: vi.fn(),
    });
    return handles;
}
