import { afterEach, describe, expect, test } from "vitest";

let importSequence = 0;
let restoreGlobals = null;

afterEach(() => {
    restoreGlobals?.();
});

describe("viewer command interactions", () => {
    test("Home command tiles switch the selected preview without changing routes", async () => {
        const fleetTile = mockElement({ dataset: { commandPanelId: "home-panel-fleet" } });
        const ariaTile = mockElement({ dataset: { commandPanelId: "home-panel-aria" } });
        const fleetPanel = mockElement({ id: "home-panel-fleet", hidden: false });
        const ariaPanel = mockElement({ id: "home-panel-aria", hidden: true });
        mockDom({
            querySelectorAll(selector) {
                if (selector === "[data-command-tile]") {
                    return [fleetTile, ariaTile];
                }
                if (selector === "[data-command-panel]") {
                    return [fleetPanel, ariaPanel];
                }
                return [];
            },
        });

        await importFresh("../../viewer/public/home/app.js");
        ariaTile.dispatch("click");

        expect(fleetTile.attributes["aria-selected"]).toBe("false");
        expect(ariaTile.attributes["aria-selected"]).toBe("true");
        expect(fleetTile.classList.contains("is-selected")).toBe(false);
        expect(ariaTile.classList.contains("is-selected")).toBe(true);
        expect(fleetPanel.hidden).toBe(true);
        expect(ariaPanel.hidden).toBe(false);
    });

    test("Diagnostics detail buttons expand and collapse inline evidence", async () => {
        const toggle = mockElement({
            attributes: {
                "aria-controls": "diagnostic-detail-battle-log",
                "aria-expanded": "false",
            },
        });
        const panel = mockElement({ id: "diagnostic-detail-battle-log", hidden: true });
        mockDom({
            getElementById(id) {
                return id === panel.id ? panel : null;
            },
            querySelector() {
                return null;
            },
            querySelectorAll(selector) {
                return selector === "[data-detail-toggle]" ? [toggle] : [];
            },
        });

        await importFresh("../../viewer/public/diagnostics/app.js");
        toggle.dispatch("click");

        expect(toggle.attributes["aria-expanded"]).toBe("true");
        expect(panel.hidden).toBe(false);
        expect(panel.classList.contains("is-open")).toBe(true);

        toggle.dispatch("click");

        expect(toggle.attributes["aria-expanded"]).toBe("false");
        expect(panel.hidden).toBe(true);
        expect(panel.classList.contains("is-open")).toBe(false);
    });
});

async function importFresh(relativePath) {
    return import(new URL(`${relativePath}?test=${importSequence += 1}`, import.meta.url).href);
}

function mockDom(documentMock) {
    const previous = {
        document: globalThis.document,
        window: globalThis.window,
    };
    globalThis.document = documentMock;
    globalThis.window = {
        requestAnimationFrame(callback) {
            callback();
        },
        setTimeout(callback) {
            callback();
            return 1;
        },
    };
    restoreGlobals = () => {
        restoreGlobal("document", previous.document);
        restoreGlobal("window", previous.window);
        restoreGlobals = null;
    };
}

function mockElement(options = {}) {
    const listeners = new Map();
    const classes = new Set();
    return {
        attributes: { ...(options.attributes ?? {}) },
        classList: {
            add(name) {
                classes.add(name);
            },
            contains(name) {
                return classes.has(name);
            },
            remove(name) {
                classes.delete(name);
            },
            toggle(name, force) {
                if (force) {
                    classes.add(name);
                } else {
                    classes.delete(name);
                }
            },
        },
        dataset: options.dataset ?? {},
        hidden: Boolean(options.hidden),
        id: options.id ?? "",
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        dispatch(type) {
            listeners.get(type)?.();
        },
        getAttribute(name) {
            return this.attributes[name] ?? "";
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
    };
}

function restoreGlobal(name, value) {
    if (value === undefined) {
        delete globalThis[name];
        return;
    }

    globalThis[name] = value;
}
