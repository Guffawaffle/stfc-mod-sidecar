import { beforeEach, describe, expect, test, vi } from "vitest";

const browserWindowMock = vi.fn();

vi.mock("node:module", () => ({
    createRequire: () => () => ({
        BrowserWindow: browserWindowMock,
    }),
}));

const { attachWindowVisibilityHandlers, default: createMainWindow } = await import("../src/main-window.mjs");

describe("main window visibility", () => {
    beforeEach(() => {
        browserWindowMock.mockReset();
        vi.useFakeTimers();
    });

    test("shows the window on ready-to-show", () => {
        const window = createFakeWindow();
        attachWindowVisibilityHandlers(window);

        window.emit("ready-to-show");

        expect(window.show).toHaveBeenCalledTimes(1);
    });

    test("falls back to show after did-finish-load when ready-to-show does not fire", () => {
        const window = createFakeWindow();
        attachWindowVisibilityHandlers(window);

        window.webContents.emit("did-finish-load");
        vi.advanceTimersByTime(250);

        expect(window.show).toHaveBeenCalledTimes(1);
    });

    test("creates a hidden BrowserWindow and installs the visibility fallback", () => {
        const window = createFakeWindow();
        browserWindowMock.mockImplementation(class BrowserWindow {
            constructor() {
                return window;
            }
        });

        createMainWindow("http://127.0.0.1:43127", {
            preloadPath: "D:/dev/stfc-mod-sidecar/packages/desktop/src/preload.cjs",
            shell: { openExternal: vi.fn() },
        });

        expect(browserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
            show: false,
        }));

        window.webContents.emit("did-finish-load");
        vi.advanceTimersByTime(250);
        expect(window.show).toHaveBeenCalledTimes(1);
    });
});

function createFakeWindow() {
    const windowEvents = new Map();
    const webContentsEvents = new Map();

    return {
        show: vi.fn(),
        isDestroyed: vi.fn(() => false),
        once: vi.fn((event, handler) => {
            windowEvents.set(event, handler);
        }),
        emit(event) {
            windowEvents.get(event)?.();
        },
        webContents: {
            once: vi.fn((event, handler) => {
                webContentsEvents.set(event, handler);
            }),
            emit(event) {
                webContentsEvents.get(event)?.();
            },
            setWindowOpenHandler: vi.fn(),
            on: vi.fn(),
        },
        loadURL: vi.fn(),
    };
}