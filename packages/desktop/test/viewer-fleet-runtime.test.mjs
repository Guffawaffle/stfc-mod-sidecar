import { afterEach, describe, expect, test } from "vitest";

let importSequence = 0;
let restoreActiveGlobals = null;

afterEach(() => {
    restoreActiveGlobals?.();
});

describe.sequential("viewer fleet runtime", () => {
    test("renders unavailable instead of empty when the broker is unavailable", async () => {
        const page = await loadFleetPage({
            ok: true,
            available: false,
            projection: null,
        });

        expect(page.requests).toEqual(["/api/fleet/projection"]);
        expect(page.requests).not.toContain("/api/events");
        expect(page.elements.status.textContent).toBe("Unavailable");
        expect(page.elements.note.textContent).toBe("Projection unavailable. The local broker did not return a current projection.");
        expect(page.elements.view.innerHTML).toContain("Fleet projection is unavailable.");
        expect(page.elements.note.textContent).not.toContain("Projection available but empty.");
    });

    test("renders the expected empty copy for an empty projection", async () => {
        const page = await loadFleetPage({
            ok: true,
            available: true,
            projection: {
                stateVersion: 7,
                updatedAt: "2026-05-18T12:00:00.000Z",
                slots: [],
            },
        });

        expect(page.elements.status.textContent).toBe("Empty");
        expect(page.elements.rowCount.textContent).toBe("0");
        expect(page.elements.note.textContent).toBe("Projection available but empty. No observed fleet rows have been stored yet.");
        expect(page.elements.view.innerHTML).toContain("No observed fleet rows are available yet.");
    });

    test("renders current rows with safe truncated labels", async () => {
        const now = new Date().toISOString();
        const page = await loadFleetPage({
            ok: true,
            available: true,
            projection: {
                stateVersion: 12,
                updatedAt: now,
                slots: [{
                    fleetKey: "fleet:ALPHA-1234567890",
                    slotKey: "slot:BRAVO-0987654321",
                    state: "assigned",
                    assignmentKind: "player_ship",
                    shipType: "hull:Explorer",
                    levelBand: "35",
                    healthBand: "tier:4",
                    updatedAt: now,
                }],
            },
        });

        expect(page.elements.status.textContent).toBe("Current");
        expect(page.elements.rowCount.textContent).toBe("1");
        expect(page.elements.note.textContent).toContain("Projection current. Showing 1 observed fleet rows");
        expect(page.elements.view.innerHTML).toContain("Fleet ALPHA1");
        expect(page.elements.view.innerHTML).toContain("Slot BRAVO0");
        expect(page.elements.view.innerHTML).not.toContain("fleet:ALPHA-1234567890");
        expect(page.elements.view.innerHTML).not.toContain("slot:BRAVO-0987654321");
    });

    test("sorts rows by slot order and hides empty slots by default", async () => {
        const now = new Date().toISOString();
        const page = await loadFleetPage({
            ok: true,
            available: true,
            projection: {
                stateVersion: 12,
                updatedAt: now,
                slots: [
                    { fleetKey: "fleet:C", slotKey: "slot-10", state: "assigned", assignmentKind: "player_ship", updatedAt: now },
                    { fleetKey: "fleet:B", slotKey: "slot-2", state: "empty", assignmentKind: "slot", updatedAt: now },
                    { fleetKey: "fleet:A", slotKey: "slot-0", state: "assigned", assignmentKind: "player_ship", updatedAt: now },
                ],
            },
        });

        expect(page.elements.rowCount.textContent).toBe("2");
        expect(page.elements.toggleEmptySlotsButton.textContent).toBe("Show empty slots");
        expect(page.elements.note.textContent).toContain("1 empty slot is hidden.");
        expect(page.elements.view.innerHTML).toContain("Slot 0");
        expect(page.elements.view.innerHTML).toContain("Slot 10");
        expect(page.elements.view.innerHTML).not.toContain("Slot 2");
        expect(page.elements.view.innerHTML.indexOf("Slot 0")).toBeLessThan(page.elements.view.innerHTML.indexOf("Slot 10"));
    });

    test("can show empty slots without refetching", async () => {
        const now = new Date().toISOString();
        const page = await loadFleetPage({
            ok: true,
            available: true,
            projection: {
                stateVersion: 12,
                updatedAt: now,
                slots: [
                    { fleetKey: "fleet:A", slotKey: "slot-0", state: "assigned", assignmentKind: "player_ship", updatedAt: now },
                    { fleetKey: "fleet:B", slotKey: "slot-2", state: "empty", assignmentKind: "slot", updatedAt: now },
                ],
            },
        });

        expect(page.requests).toEqual(["/api/fleet/projection"]);

        await page.clickToggleEmptySlots();

        expect(page.requests).toEqual(["/api/fleet/projection"]);
        expect(page.elements.rowCount.textContent).toBe("2");
        expect(page.elements.toggleEmptySlotsButton.textContent).toBe("Hide empty slots");
        expect(page.elements.view.innerHTML).toContain("Slot 2");
        expect(page.elements.view.innerHTML).toContain("Empty");
    });

    test("requests the fleet projection route and not events", async () => {
        const page = await loadFleetPage({
            ok: true,
            available: false,
            projection: null,
        });

        expect(page.requests).toContain("/api/fleet/projection");
        expect(page.requests.some((request) => request.includes("/api/events"))).toBe(false);
    });

    test("manual refresh fetches the projection again", async () => {
        const page = await loadFleetPage([
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            projectionPayload({ stateVersion: 8, updatedAt: "2026-05-18T12:01:00.000Z" }),
        ]);

        expect(page.requests).toEqual(["/api/fleet/projection"]);

        await page.clickRefresh();

        expect(page.requests).toEqual([
            "/api/fleet/projection",
            "/api/fleet/projection",
        ]);
        expect(page.elements.version.textContent).toBe("v8");
    });

    test("visibility and focus refresh the projection without polling", async () => {
        const page = await loadFleetPage([
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            projectionPayload({ stateVersion: 8, updatedAt: "2026-05-18T12:01:00.000Z" }),
            projectionPayload({ stateVersion: 9, updatedAt: "2026-05-18T12:02:00.000Z" }),
        ]);

        page.setVisibilityState("hidden");
        await page.dispatchDocumentEvent("visibilitychange");
        expect(page.requests).toEqual(["/api/fleet/projection"]);

        page.setVisibilityState("visible");
        await page.dispatchDocumentEvent("visibilitychange");
        expect(page.requests).toEqual([
            "/api/fleet/projection",
            "/api/fleet/projection",
        ]);
        expect(page.elements.version.textContent).toBe("v8");

        await page.dispatchWindowEvent("focus");
        expect(page.requests).toEqual([
            "/api/fleet/projection",
            "/api/fleet/projection",
            "/api/fleet/projection",
        ]);
        expect(page.elements.version.textContent).toBe("v9");
        expect(page.setIntervalCalls).toBe(0);
    });

    test("fleet projection stream invalidates and refetches without using event history", async () => {
        const page = await loadFleetPage([
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            projectionPayload({ stateVersion: 8, updatedAt: "2026-05-18T12:01:00.000Z" }),
        ]);

        expect(page.requests).toEqual(["/api/fleet/projection"]);
        expect(page.eventSources).toHaveLength(1);
        expect(page.eventSources[0].url).toBe("/api/fleet/stream");

        await page.eventSources[0].dispatch("fleet-projection-changed", {
            data: JSON.stringify({
                ok: true,
                reason: "fleet-sync",
                projection: {
                    stateVersion: 8,
                    slotCount: 0,
                    stateHash: "hash-8",
                },
            }),
        });
        await page.flushAsync();

        expect(page.requests).toEqual([
            "/api/fleet/projection",
            "/api/fleet/projection",
        ]);
        expect(page.requests.some((request) => request.includes("/api/events"))).toBe(false);
        expect(page.elements.version.textContent).toBe("v8");
        expect(page.setIntervalCalls).toBe(0);
    });

    test("uses slow fallback polling only when EventSource is unavailable", async () => {
        const page = await loadFleetPage(
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            { eventSource: false },
        );

        expect(page.eventSources).toHaveLength(0);
        expect(page.setIntervalCalls).toBe(1);
    });

    test("route-entry hook fetches again when explicitly re-entered", async () => {
        const page = await loadFleetPage([
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            projectionPayload({ stateVersion: 8, updatedAt: "2026-05-18T12:01:00.000Z" }),
            projectionPayload({ stateVersion: 9, updatedAt: "2026-05-18T12:02:00.000Z" }),
        ]);

        const routeEvent = page.module.fleetProjectionPageEnterEvent();
        await page.dispatchWindowEvent(routeEvent, { detail: { page: "about" } });
        expect(page.requests).toEqual(["/api/fleet/projection"]);

        await page.dispatchWindowEvent(routeEvent, { detail: { page: "fleet" } });
        expect(page.requests).toEqual([
            "/api/fleet/projection",
            "/api/fleet/projection",
        ]);
        expect(page.elements.version.textContent).toBe("v8");

        await page.dispatchWindowEvent(routeEvent, { detail: { page: "fleet" } });
        expect(page.requests).toEqual([
            "/api/fleet/projection",
            "/api/fleet/projection",
            "/api/fleet/projection",
        ]);
        expect(page.elements.version.textContent).toBe("v9");
    });
});

async function loadFleetPage(payload, options = {}) {
    restoreActiveGlobals?.();

    const previousGlobals = {
        document: globalThis.document,
        EventSource: globalThis.EventSource,
        Event: globalThis.Event,
        fetch: globalThis.fetch,
        CustomEvent: globalThis.CustomEvent,
        window: globalThis.window,
    };
    const dom = createFleetDom();
    const eventSources = [];
    const requests = [];
    const responses = Array.isArray(payload) ? [...payload] : [payload];
    let setIntervalCalls = 0;
    const MockEventSource = createMockEventSourceClass(eventSources);
    const windowMock = createEventTarget({
        clearTimeout,
        setTimeout,
        EventSource: options.eventSource === false ? undefined : MockEventSource,
        setInterval() {
            setIntervalCalls += 1;
            return 1;
        },
        clearInterval() { },
    });

    globalThis.document = dom.document;
    globalThis.window = windowMock;
    if (options.eventSource === false) {
        delete globalThis.EventSource;
    } else {
        globalThis.EventSource = MockEventSource;
    }
    globalThis.Event = MockEvent;
    globalThis.CustomEvent = MockCustomEvent;
    globalThis.fetch = async (input) => {
        requests.push(String(input));
        const currentPayload = responses.length > 1 ? responses.shift() : responses[0];
        return {
            async json() {
                return currentPayload;
            },
        };
    };

    restoreActiveGlobals = () => {
        restoreGlobal("document", previousGlobals.document);
        restoreGlobal("EventSource", previousGlobals.EventSource);
        restoreGlobal("Event", previousGlobals.Event);
        restoreGlobal("fetch", previousGlobals.fetch);
        restoreGlobal("CustomEvent", previousGlobals.CustomEvent);
        restoreGlobal("window", previousGlobals.window);
        restoreActiveGlobals = null;
    };

    const moduleUrl = new URL(`../../viewer/public/fleet/app.js?test=${importSequence += 1}`, import.meta.url);
    const module = await import(moduleUrl.href);
    return {
        clickRefresh: () => dispatchElementEvent(dom.elements.refreshButton, "click"),
        clickToggleEmptySlots: () => dispatchElementEvent(dom.elements.toggleEmptySlotsButton, "click"),
        dispatchDocumentEvent: (type, init) => dom.document.dispatchEvent(new MockEvent(type, init)),
        dispatchWindowEvent: (type, init) => windowMock.dispatchEvent(new MockCustomEvent(type, init)),
        elements: dom.elements,
        eventSources,
        flushAsync,
        module,
        requests,
        setIntervalCalls,
        setVisibilityState(value) {
            dom.document.visibilityState = value;
        },
    };
}

function createFleetDom() {
    const elements = {
        endpoint: new MockElement(),
        note: new MockElement(),
        refreshButton: new MockElement(),
        rowCount: new MockElement(),
        status: new MockElement({ dataset: { state: "off" }, textContent: "Starting..." }),
        toggleEmptySlotsButton: new MockElement(),
        updated: new MockElement(),
        version: new MockElement(),
        view: new MockElement({ innerHTML: '<div class="empty-state">Loading current fleet projection...</div>' }),
    };
    const selectors = new Map([
        ["#projection-endpoint", elements.endpoint],
        ["#projection-note", elements.note],
        ["#projection-row-count", elements.rowCount],
        ["#projection-status", elements.status],
        ["#projection-updated", elements.updated],
        ["#projection-version", elements.version],
        ["#projection-view", elements.view],
        ["#refresh-button", elements.refreshButton],
        ["#toggle-empty-slots-button", elements.toggleEmptySlotsButton],
    ]);
    const listeners = new Map();

    return {
        document: {
            visibilityState: "visible",
            addEventListener(type, handler) {
                listeners.set(type, handler);
            },
            dispatchEvent(event) {
                const handler = listeners.get(event.type);
                if (!handler) {
                    return true;
                }

                const result = handler.call(this, event);
                return result instanceof Promise ? result.then(() => true) : true;
            },
            querySelector(selector) {
                return selectors.get(selector) ?? null;
            },
        },
        elements,
    };
}

class MockElement {
    constructor(options = {}) {
        this.dataset = options.dataset ?? {};
        this.listeners = new Map();
        this.title = options.title ?? "";
        this._innerHTML = "";
        this._textContent = "";
        if (options.innerHTML !== undefined) {
            this.innerHTML = options.innerHTML;
        }
        if (options.textContent !== undefined) {
            this.textContent = options.textContent;
        }
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(value) {
        this._innerHTML = String(value ?? "");
        this._textContent = stripHtml(this._innerHTML);
    }

    get textContent() {
        return this._textContent;
    }

    set textContent(value) {
        this._textContent = String(value ?? "");
        this._innerHTML = this._textContent;
    }
}

function restoreGlobal(name, value) {
    if (value === undefined) {
        delete globalThis[name];
        return;
    }

    globalThis[name] = value;
}

function stripHtml(value) {
    return String(value ?? "").replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
}

class MockEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
        this.data = init.data;
    }
}

class MockCustomEvent extends MockEvent { }

function createEventTarget(base = {}) {
    const listeners = new Map();
    return {
        ...base,
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        dispatchEvent(event) {
            const handler = listeners.get(event.type);
            if (!handler) {
                return true;
            }

            const result = handler.call(this, event);
            return result instanceof Promise ? result.then(() => true) : true;
        },
    };
}

function dispatchElementEvent(element, type) {
    const handler = element.listeners.get(type);
    if (!handler) {
        return;
    }

    return handler(new MockEvent(type));
}

function projectionPayload(projection) {
    return {
        ok: true,
        available: true,
        projection: {
            slots: [],
            ...projection,
        },
    };
}

function createMockEventSourceClass(eventSources) {
    return class MockEventSource {
        constructor(url) {
            this.closed = false;
            this.listeners = new Map();
            this.url = url;
            eventSources.push(this);
        }

        addEventListener(type, handler) {
            this.listeners.set(type, handler);
        }

        close() {
            this.closed = true;
        }

        dispatch(type, init = {}) {
            const handler = this.listeners.get(type);
            if (!handler) {
                return undefined;
            }

            const result = handler(new MockEvent(type, init));
            return result instanceof Promise ? result : Promise.resolve(result);
        }
    };
}

async function flushAsync() {
    await Promise.resolve();
    await Promise.resolve();
}
