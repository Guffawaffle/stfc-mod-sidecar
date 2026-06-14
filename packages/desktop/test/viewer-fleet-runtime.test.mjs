import { afterEach, describe, expect, test } from "vitest";

const FLEET_PROJECTION_ROUTE = "/api/fleet/projection";
const FLEET_ACTIVITY_ROUTE = "/api/fleet/activity?limit=6";
const FLEET_ALERT_INTENTS_ROUTE = "/api/fleet/alert-intents?limit=8";
const FLEET_SHIP_COMBAT_PREVIEW_ROUTE = "/api/fleet/ship-combat-preview";
const INITIAL_FLEET_REQUESTS = [
    FLEET_PROJECTION_ROUTE,
    FLEET_ACTIVITY_ROUTE,
    FLEET_ALERT_INTENTS_ROUTE,
    FLEET_SHIP_COMBAT_PREVIEW_ROUTE,
];

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

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);
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
        expect(page.elements.note.textContent).toContain("Current: 1 observed fleet row.");
        expect(page.elements.debug.textContent).toContain("Fetch:");
        expect(page.elements.debug.textContent).not.toContain("Fetch: Never");
        expect(page.elements.debug.textContent).not.toContain("Render: Never");
        expect(page.elements.debug.textContent).toContain("Version: v12");
        expect(page.elements.view.innerHTML).toContain("Slot BRAVO0");
        expect(page.elements.view.innerHTML).not.toContain("Fleet ALPHA1");
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
                    { fleetKey: "fleet:C", slotKey: "slot-9", state: "assigned", assignmentKind: "player_ship", updatedAt: now },
                    { fleetKey: "fleet:B", slotKey: "slot-2", state: "empty", assignmentKind: "slot", updatedAt: now },
                    { fleetKey: "fleet:A", slotKey: "slot-0", state: "assigned", assignmentKind: "player_ship", updatedAt: now },
                ],
            },
        });

        expect(page.elements.rowCount.textContent).toBe("2");
        expect(page.elements.toggleEmptySlotsButton.textContent).toBe("Show empty slots");
        expect(page.elements.note.textContent).toContain("1 empty slot is hidden.");
        expect(page.elements.view.innerHTML).toContain("Slot 1");
        expect(page.elements.view.innerHTML).toContain("Slot 10");
        expect(page.elements.view.innerHTML).not.toContain("Slot 3");
        expect(page.elements.view.innerHTML).not.toContain("<th>Fleet</th>");
        expect(page.elements.view.innerHTML).not.toContain("<th>Updated</th>");
        expect(page.elements.view.innerHTML.indexOf("Slot 1")).toBeLessThan(page.elements.view.innerHTML.indexOf("Slot 10"));
    });

    test("renders passive ETA for warping rows with observed active timer data", async () => {
        const observedAt = new Date(Date.now() + 5000).toISOString();
        const page = await loadFleetPage({
            ok: true,
            available: true,
            projection: {
                stateVersion: 13,
                updatedAt: observedAt,
                slots: [
                    {
                        fleetKey: "fleet:A",
                        slotKey: "slot-0",
                        state: "warping",
                        assignmentKind: "player_ship",
                        activeTimerRemainingMs: 65000,
                        activeTimerSource: "FleetPlayerData.Timer.RemainingTime",
                        updatedAt: observedAt,
                    },
                    {
                        fleetKey: "fleet:B",
                        slotKey: "slot-1",
                        state: "docked",
                        assignmentKind: "player_ship",
                        activeTimerRemainingMs: 65000,
                        updatedAt: observedAt,
                    },
                ],
            },
        });

        expect(page.elements.view.innerHTML).toContain("Warping");
        expect(page.elements.view.innerHTML).toContain("ETA 1:05");
        expect(page.elements.view.innerHTML).toContain("Docked");
        expect(page.elements.view.innerHTML.match(/ETA/g)).toHaveLength(1);
        expect(arrivalBellTokensFor(page)).toHaveLength(1);
        expect(page.elements.view.innerHTML).toContain(">Notify</button>");
        expect(page.setIntervalCalls).toBe(1);
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

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);

        await page.clickToggleEmptySlots();

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);
        expect(page.elements.rowCount.textContent).toBe("2");
        expect(page.elements.toggleEmptySlotsButton.textContent).toBe("Hide empty slots");
        expect(page.elements.view.innerHTML).toContain("Slot 3");
        expect(page.elements.view.innerHTML).toContain("Empty");
    });

    test("requests the fleet projection route and not events", async () => {
        const page = await loadFleetPage({
            ok: true,
            available: false,
            projection: null,
        });

        expect(page.requests).toContain("/api/fleet/projection");
        expect(page.requests).toContain("/api/fleet/activity?limit=6");
        expect(page.requests).toContain("/api/fleet/alert-intents?limit=8");
        expect(page.requests.some((request) => request.includes("/api/events"))).toBe(false);
    });

    test("renders provider-neutral fleet alert intents from the dedicated read route", async () => {
        const page = await loadFleetPage(
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            {
                alertIntentPayload: alertIntentPayload([{
                    sequenceId: 42,
                    eventKey: "fleet-alert-42",
                    intent: {
                        type: "fleet.alert_intent",
                        schemaVersion: "stfc.sidecar.fleet-alert-intent.v0",
                        intentId: "fleet-alert-intent:abc123",
                        dedupeKey: "kind=fleet_arrival|fleetId=12345678901234567890|observedAt=1781181296000",
                        kind: "fleet_arrival",
                        eventType: "fleet.arrived_in_system",
                        timestamp: "2026-06-11T12:34:56.000Z",
                        evidence: {
                            protocolVersion: "stfc.sidecar.events.v0",
                            type: "fleet.alert_evidence",
                            schemaVersion: "stfc.fleet.alert_evidence.v0",
                            eventType: "fleet.arrived_in_system",
                            timestamp: "2026-06-11T12:34:56.000Z",
                            source: "stfc-community-mod",
                        },
                        fleet: {
                            fleetId: "12345678901234567890",
                            slotIndex: 2,
                            state: { current: 512, currentName: "Impulsing" },
                        },
                        ship: {
                            shipId: "9876543210987654321",
                            displayName: "Squall",
                        },
                        missingEvidence: ["systemId"],
                    },
                }]),
            },
        );

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);
        expect(page.elements.alertIntentsView.innerHTML).toContain("Fleet arrival intent");
        expect(page.elements.alertIntentsView.innerHTML).toContain("fleet.arrived_in_system");
        expect(page.elements.alertIntentsView.innerHTML).toContain("fleet 12345678901234567890");
        expect(page.elements.alertIntentsView.innerHTML).toContain("ship ID 9876543210987654321");
        expect(page.elements.alertIntentsView.innerHTML).toContain("system evidence missing");
        expect(page.elements.alertIntentsView.innerHTML).toContain("Missing: systemId");
        expect(page.elements.alertIntentsView.innerHTML).toContain("fleet-alert-intent:abc123");
        expect(page.elements.alertIntentsView.innerHTML).toContain("kind=fleet_arrival|fleetId=12345678901234567890");
        expect(page.elements.alertIntentsView.innerHTML).not.toContain("notification");
        expect(page.requests.some((request) => request.includes("/api/events"))).toBe(false);
    });

    test("renders recent activity preview without raw event evidence", async () => {
        const page = await loadFleetPage(
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            {
                activityPayload: activityPayload([{
                    id: "battle-42",
                    lineNumber: 42,
                    eventType: "battle.report",
                    title: "Interceptor Hostile",
                    subtitle: "Guffawaffle",
                    chips: ["battle.report", "battleType 8", "initiator_victory"],
                    timestamp: "2026-05-24T19:59:00.000Z",
                    rawJson: "must not render",
                }]),
            },
        );

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);
        expect(page.elements.activityView.innerHTML).toContain("Interceptor Hostile");
        expect(page.elements.activityView.innerHTML).toContain("battle.report");
        expect(page.elements.activityView.innerHTML).toContain("L42");
        expect(page.elements.activityView.innerHTML).not.toContain("must not render");
        expect(page.elements.activityView.innerHTML).not.toContain("Raw JSON");
        expect(page.requests.some((request) => request.includes("/api/events"))).toBe(false);
    });

    test("manual refresh fetches the projection again", async () => {
        const page = await loadFleetPage([
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            projectionPayload({ stateVersion: 8, updatedAt: "2026-05-18T12:01:00.000Z" }),
        ]);

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);

        await page.clickRefresh();

        expect(projectionRequests(page)).toHaveLength(2);
        expect(activityRequests(page)).toHaveLength(2);
        expect(alertIntentRequests(page)).toHaveLength(2);
        expect(combatPreviewRequests(page)).toHaveLength(2);
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
        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);

        page.setVisibilityState("visible");
        await page.dispatchDocumentEvent("visibilitychange");
        expect(projectionRequests(page)).toHaveLength(2);
        expect(activityRequests(page)).toHaveLength(2);
        expect(alertIntentRequests(page)).toHaveLength(2);
        expect(combatPreviewRequests(page)).toHaveLength(2);
        expect(page.elements.version.textContent).toBe("v8");

        await page.dispatchWindowEvent("focus");
        expect(projectionRequests(page)).toHaveLength(3);
        expect(activityRequests(page)).toHaveLength(3);
        expect(alertIntentRequests(page)).toHaveLength(3);
        expect(combatPreviewRequests(page)).toHaveLength(3);
        expect(page.elements.version.textContent).toBe("v9");
        expect(page.setIntervalCalls).toBe(0);
    });

    test("fleet projection stream invalidates and refetches without using event history", async () => {
        const page = await loadFleetPage([
            projectionPayload({ stateVersion: 7, updatedAt: "2026-05-18T12:00:00.000Z" }),
            projectionPayload({ stateVersion: 8, updatedAt: "2026-05-18T12:01:00.000Z" }),
        ]);

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);
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

        expect(projectionRequests(page)).toHaveLength(2);
        expect(activityRequests(page)).toHaveLength(1);
        expect(alertIntentRequests(page)).toHaveLength(2);
        expect(combatPreviewRequests(page)).toHaveLength(2);
        expect(page.requests.some((request) => request.includes("/api/events"))).toBe(false);
        expect(page.elements.version.textContent).toBe("v8");
        expect(page.elements.debug.textContent).not.toContain("Event: Never");
        expect(page.elements.debug.textContent).toContain("Version: v8");
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
        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);

        await page.dispatchWindowEvent(routeEvent, { detail: { page: "fleet" } });
        expect(projectionRequests(page)).toHaveLength(2);
        expect(activityRequests(page)).toHaveLength(2);
        expect(alertIntentRequests(page)).toHaveLength(2);
        expect(combatPreviewRequests(page)).toHaveLength(2);
        expect(page.elements.version.textContent).toBe("v8");

        await page.dispatchWindowEvent(routeEvent, { detail: { page: "fleet" } });
        expect(projectionRequests(page)).toHaveLength(3);
        expect(activityRequests(page)).toHaveLength(3);
        expect(alertIntentRequests(page)).toHaveLength(3);
        expect(combatPreviewRequests(page)).toHaveLength(3);
        expect(page.elements.version.textContent).toBe("v9");
    });

    test("toggles a compact recent combat summary per ship row using the exact-ID preview", async () => {
        const now = "2026-05-24T19:59:00.000Z";
        const page = await loadFleetPage(
            projectionPayload({
                stateVersion: 12,
                updatedAt: now,
                slots: [{
                    fleetKey: "fleet:ALPHA-1234567890",
                    slotKey: "slot-0",
                    state: "assigned",
                    assignmentKind: "player_ship",
                    shipIdentityId: "2682548280591992155",
                    shipType: "hull:USS Relativity",
                    updatedAt: now,
                }],
            }),
            {
                combatPreviewPayload: combatPreviewPayload([
                    {
                        slotKey: "slot-0",
                        shipId: "2682548280591992155",
                        recentBattles: [{
                            observedAt: now,
                            outcome: "initiator_victory",
                            opponentName: "Klingon Patrol",
                            opponentType: "hostile",
                            rounds: 8,
                            source: "battle.report",
                        }],
                    },
                ]),
            },
        );

        expect(page.elements.view.innerHTML).not.toContain("Recent combat");

        page.module.toggleShipCombatSummary("slot-0");

        expect(page.elements.view.innerHTML).toContain("Recent combat");
        expect(page.elements.view.innerHTML).toContain("Klingon Patrol");
        expect(page.elements.view.innerHTML).toContain("Initiator Victory");
    });

    test("delegated row clicks expand combat summaries", async () => {
        const now = "2026-05-24T19:59:00.000Z";
        const page = await loadFleetPage(
            projectionPayload({
                stateVersion: 12,
                updatedAt: now,
                slots: [{
                    fleetKey: "fleet:ALPHA-1234567890",
                    slotKey: "slot-0",
                    state: "assigned",
                    assignmentKind: "player_ship",
                    shipIdentityId: "2682548280591992155",
                    shipType: "hull:USS Relativity",
                    updatedAt: now,
                }],
            }),
            {
                combatPreviewPayload: combatPreviewPayload([
                    {
                        slotKey: "slot-0",
                        shipId: "2682548280591992155",
                        recentBattles: [{
                            observedAt: now,
                            outcome: "initiator_victory",
                            opponentName: "Klingon Patrol",
                            opponentType: "hostile",
                            rounds: 8,
                            source: "battle.report",
                        }],
                    },
                ]),
            },
        );

        expect(page.elements.view.innerHTML).not.toContain("Recent combat");

        await page.clickProjectionView(createFleetRowClickTarget(page, "slot-0"));

        expect(page.elements.view.innerHTML).toContain("Recent combat");
        expect(page.elements.view.innerHTML).toContain("Klingon Patrol");
    });

    test("nested row controls do not trigger row expansion", async () => {
        const now = new Date(Date.now() + 5000).toISOString();
        const page = await loadFleetPage(
            projectionPayload({
                stateVersion: 12,
                updatedAt: now,
                slots: [{
                    fleetKey: "fleet:ALPHA-1234567890",
                    slotKey: "slot-0",
                    state: "warping",
                    assignmentKind: "player_ship",
                    shipIdentityId: "2682548280591992155",
                    shipType: "hull:USS Relativity",
                    activeTimerRemainingMs: 65000,
                    updatedAt: now,
                }],
            }),
            {
                combatPreviewPayload: combatPreviewPayload([
                    {
                        slotKey: "slot-0",
                        shipId: "2682548280591992155",
                        recentBattles: [{
                            observedAt: now,
                            outcome: "initiator_victory",
                            opponentName: "Klingon Patrol",
                            opponentType: "hostile",
                            rounds: 8,
                            source: "battle.report",
                        }],
                    },
                ]),
            },
        );

        expect(page.elements.view.innerHTML).toContain("ETA 1:05");
        expect(page.elements.view.innerHTML).not.toContain("Recent combat");

        await page.clickProjectionView(createFleetRowClickTarget(page, "slot-0", { controlSelector: "[data-fleet-row-control]" }));

        expect(page.elements.view.innerHTML).not.toContain("Recent combat");
    });

    test("arrival bell click arms and disarms without expanding the row", async () => {
        const observedAt = new Date(Date.now() + 5000).toISOString();
        const audio = createMockAudioContext();
        const page = await loadFleetPage(
            projectionPayload({
                stateVersion: 12,
                updatedAt: observedAt,
                slots: [{
                    fleetKey: "fleet:ALPHA-1234567890",
                    slotKey: "slot-0",
                    state: "warping",
                    assignmentKind: "player_ship",
                    shipIdentityId: "2682548280591992155",
                    shipType: "hull:USS Relativity",
                    activeTimerRemainingMs: 65000,
                    updatedAt: observedAt,
                }],
            }),
            {
                AudioContext: audio.AudioContext,
                combatPreviewPayload: combatPreviewPayload([
                    {
                        slotKey: "slot-0",
                        shipId: "2682548280591992155",
                        recentBattles: [{
                            observedAt,
                            outcome: "initiator_victory",
                            opponentName: "Klingon Patrol",
                            opponentType: "hostile",
                            rounds: 8,
                            source: "battle.report",
                        }],
                    },
                ]),
            },
        );

        expect(page.elements.view.innerHTML).toContain(">Notify</button>");
        expect(page.elements.view.innerHTML).not.toContain("Recent combat");

        await page.clickProjectionView(createArrivalBellClickTarget(page, "slot-0"));
        await page.flushAsync();

        expect(page.elements.view.innerHTML).toContain("aria-pressed=\"true\"");
        expect(page.elements.view.innerHTML).toContain(">Armed</button>");
        expect(page.elements.view.innerHTML).not.toContain("Recent combat");
        expect(audio.calls.resumes).toBe(1);
        expect(audio.calls.starts).toBe(0);

        await page.clickProjectionView(createArrivalBellClickTarget(page, "slot-0"));

        expect(page.elements.view.innerHTML).not.toContain("aria-pressed=\"true\"");
        expect(page.elements.view.innerHTML).toContain(">Notify</button>");
        expect(page.elements.view.innerHTML).not.toContain("Recent combat");
    });

    test("arrival bell reports unavailable audio instead of arming silently", async () => {
        const observedAt = new Date(Date.now() + 5000).toISOString();
        const page = await loadFleetPage(
            projectionPayload({
                stateVersion: 12,
                updatedAt: observedAt,
                slots: [{
                    fleetKey: "fleet:ALPHA-1234567890",
                    slotKey: "slot-0",
                    state: "warping",
                    assignmentKind: "player_ship",
                    activeTimerRemainingMs: 65000,
                    updatedAt: observedAt,
                }],
            }),
        );

        await page.clickProjectionView(createArrivalBellClickTarget(page, "slot-0"));

        expect(page.elements.view.innerHTML).not.toContain("aria-pressed=\"true\"");
        expect(page.elements.view.innerHTML).toContain("Audio unavailable");
    });

    test("arrival bell fires one chime and clears armed state when the observed timer is due", async () => {
        const observedAt = new Date(Date.now() - 2000).toISOString();
        const audio = createMockAudioContext();
        const page = await loadFleetPage(
            projectionPayload({
                stateVersion: 12,
                updatedAt: observedAt,
                slots: [{
                    fleetKey: "fleet:ALPHA-1234567890",
                    slotKey: "slot-0",
                    state: "warping",
                    assignmentKind: "player_ship",
                    shipIdentityId: "2682548280591992155",
                    activeTimerRemainingMs: 500,
                    updatedAt: observedAt,
                }],
            }),
            { AudioContext: audio.AudioContext },
        );

        expect(page.elements.view.innerHTML).toContain("ETA due");
        expect(audio.calls.starts).toBe(0);

        await page.clickProjectionView(createArrivalBellClickTarget(page, "slot-0"));
        page.runIntervals();

        expect(audio.calls.starts).toBe(1);
        expect(page.elements.view.innerHTML).not.toContain("aria-pressed=\"true\"");
        expect(page.elements.view.innerHTML).toContain(">Notify</button>");

        page.runIntervals();

        expect(audio.calls.starts).toBe(1);
    });

    test("arrival bell cancels when the row identity changes before arrival", async () => {
        const futureObservedAt = new Date(Date.now() + 5000).toISOString();
        const dueObservedAt = new Date(Date.now() - 2000).toISOString();
        const audio = createMockAudioContext();
        const page = await loadFleetPage(
            [
                projectionPayload({
                    stateVersion: 12,
                    updatedAt: futureObservedAt,
                    slots: [{
                        fleetKey: "fleet:ALPHA-1234567890",
                        slotKey: "slot-0",
                        state: "warping",
                        assignmentKind: "player_ship",
                        shipIdentityId: "2682548280591992155",
                        activeTimerRemainingMs: 65000,
                        updatedAt: futureObservedAt,
                    }],
                }),
                projectionPayload({
                    stateVersion: 13,
                    updatedAt: dueObservedAt,
                    slots: [{
                        fleetKey: "fleet:BRAVO-1234567890",
                        slotKey: "slot-0",
                        state: "warping",
                        assignmentKind: "player_ship",
                        shipIdentityId: "998877665544332211",
                        activeTimerRemainingMs: 500,
                        updatedAt: dueObservedAt,
                    }],
                }),
            ],
            { AudioContext: audio.AudioContext },
        );

        await page.clickProjectionView(createArrivalBellClickTarget(page, "slot-0"));
        await page.flushAsync();

        expect(page.elements.view.innerHTML).toContain("aria-pressed=\"true\"");

        await page.clickRefresh();
        page.runIntervals();

        expect(page.elements.version.textContent).toBe("v13");
        expect(page.elements.view.innerHTML).not.toContain("aria-pressed=\"true\"");
        expect(audio.calls.starts).toBe(0);
    });

    test("expand all and collapse all control ship combat summaries without extra fetches", async () => {
        const now = "2026-05-24T19:59:00.000Z";
        const page = await loadFleetPage(
            projectionPayload({
                stateVersion: 12,
                updatedAt: now,
                slots: [
                    { fleetKey: "fleet:A", slotKey: "slot-0", state: "assigned", assignmentKind: "player_ship", shipIdentityId: "111", updatedAt: now },
                    { fleetKey: "fleet:B", slotKey: "slot-1", state: "assigned", assignmentKind: "player_ship", shipIdentityId: "222", updatedAt: now },
                ],
            }),
            {
                combatPreviewPayload: combatPreviewPayload([
                    { slotKey: "slot-0", shipId: "111", recentBattles: [{ observedAt: now, outcome: "victory", opponentName: "Hostile One", source: "battle.report" }] },
                    { slotKey: "slot-1", shipId: "222", recentBattles: [{ observedAt: now, outcome: "defeat", opponentName: "Hostile Two", source: "battle.report" }] },
                ]),
            },
        );

        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);

        await page.clickExpandAllShipCombat();
        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);
        expect(page.elements.view.innerHTML).toContain("Hostile One");
        expect(page.elements.view.innerHTML).toContain("Hostile Two");

        await page.clickCollapseAllShipCombat();
        expect(page.requests).toEqual(INITIAL_FLEET_REQUESTS);
        expect(page.elements.view.innerHTML).not.toContain("Hostile One");
        expect(page.elements.view.innerHTML).not.toContain("Hostile Two");
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
    const projectionResponses = Array.isArray(payload) ? [...payload] : [payload];
    const configuredActivityPayload = options.activityPayload ?? activityPayload();
    const activityResponses = Array.isArray(configuredActivityPayload) ? [...configuredActivityPayload] : [configuredActivityPayload];
    const configuredAlertIntentPayload = options.alertIntentPayload ?? alertIntentPayload();
    const alertIntentResponses = Array.isArray(configuredAlertIntentPayload)
        ? [...configuredAlertIntentPayload]
        : [configuredAlertIntentPayload];
    const configuredCombatPreviewPayload = options.combatPreviewPayload ?? combatPreviewPayload();
    const combatPreviewResponses = Array.isArray(configuredCombatPreviewPayload)
        ? [...configuredCombatPreviewPayload]
        : [configuredCombatPreviewPayload];
    let setIntervalCalls = 0;
    let nextIntervalId = 0;
    const intervalCallbacks = new Map();
    const MockEventSource = createMockEventSourceClass(eventSources);
    const windowMock = createEventTarget({
        AudioContext: options.AudioContext,
        clearTimeout,
        setTimeout,
        EventSource: options.eventSource === false ? undefined : MockEventSource,
        webkitAudioContext: options.webkitAudioContext,
        setInterval(callback) {
            setIntervalCalls += 1;
            const id = nextIntervalId += 1;
            intervalCallbacks.set(id, callback);
            return id;
        },
        clearInterval(id) {
            intervalCallbacks.delete(id);
        },
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
        const request = String(input);
        requests.push(request);
        const responseSet = request.startsWith("/api/fleet/activity")
            ? activityResponses
            : (request === FLEET_ALERT_INTENTS_ROUTE
                ? alertIntentResponses
                : (request === FLEET_SHIP_COMBAT_PREVIEW_ROUTE ? combatPreviewResponses : projectionResponses));
        const currentPayload = responseSet.length > 1 ? responseSet.shift() : responseSet[0];
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
        clickCollapseAllShipCombat: () => dispatchElementEvent(dom.elements.collapseAllShipCombatButton, "click"),
        clickExpandAllShipCombat: () => dispatchElementEvent(dom.elements.expandAllShipCombatButton, "click"),
        clickProjectionView: (target) => dispatchElementEvent(dom.elements.view, "click", { target }),
        clickRefresh: () => dispatchElementEvent(dom.elements.refreshButton, "click"),
        clickToggleEmptySlots: () => dispatchElementEvent(dom.elements.toggleEmptySlotsButton, "click"),
        dispatchDocumentEvent: (type, init) => dom.document.dispatchEvent(new MockEvent(type, init)),
        dispatchWindowEvent: (type, init) => windowMock.dispatchEvent(new MockCustomEvent(type, init)),
        elements: dom.elements,
        eventSources,
        flushAsync,
        module,
        requests,
        runIntervals() {
            for (const callback of intervalCallbacks.values()) {
                callback();
            }
        },
        get setIntervalCalls() {
            return setIntervalCalls;
        },
        setVisibilityState(value) {
            dom.document.visibilityState = value;
        },
    };
}

function projectionRequests(page) {
    return page.requests.filter((request) => request === FLEET_PROJECTION_ROUTE);
}

function activityRequests(page) {
    return page.requests.filter((request) => request === FLEET_ACTIVITY_ROUTE);
}

function alertIntentRequests(page) {
    return page.requests.filter((request) => request === FLEET_ALERT_INTENTS_ROUTE);
}

function combatPreviewRequests(page) {
    return page.requests.filter((request) => request === FLEET_SHIP_COMBAT_PREVIEW_ROUTE);
}

function createFleetDom() {
    const elements = {
        activityView: new MockElement({ innerHTML: '<div class="empty-state">Loading recent activity preview...</div>' }),
        alertIntentsView: new MockElement({ innerHTML: '<div class="empty-state">Loading fleet alert intents...</div>' }),
        collapseAllShipCombatButton: new MockElement(),
        debug: new MockElement(),
        endpoint: new MockElement(),
        expandAllShipCombatButton: new MockElement(),
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
        ["#fleet-activity-view", elements.activityView],
        ["#fleet-alert-intents-view", elements.alertIntentsView],
        ["#collapse-all-ship-combat-button", elements.collapseAllShipCombatButton],
        ["#expand-all-ship-combat-button", elements.expandAllShipCombatButton],
        ["#projection-debug", elements.debug],
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
        this.target = init.target;
        this.propagationStopped = false;
    }

    stopPropagation() {
        this.propagationStopped = true;
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

function dispatchElementEvent(element, type, init = {}) {
    const handler = element.listeners.get(type);
    if (!handler) {
        return;
    }

    return handler(new MockEvent(type, init));
}

function createFleetRowClickTarget(page, slotKey, options = {}) {
    const token = dataSlotTokenFor(page, slotKey);
    const row = {
        getAttribute(name) {
            return name === "data-slot-token" ? token : null;
        },
    };
    const control = options.controlSelector ? {} : null;

    return {
        closest(selector) {
            if (selector === "[data-ship-combat-close]") {
                return null;
            }
            if (selector === "[data-ship-combat-row]") {
                return row;
            }
            if (control && selectorListContains(selector, options.controlSelector)) {
                return control;
            }
            return null;
        },
    };
}

function createArrivalBellClickTarget(page, slotKey) {
    const bellToken = dataArrivalBellTokenFor(page);
    const rowToken = dataSlotTokenFor(page, slotKey);
    const button = {
        getAttribute(name) {
            return name === "data-arrival-bell-token" ? bellToken : null;
        },
    };
    const row = {
        getAttribute(name) {
            return name === "data-slot-token" ? rowToken : null;
        },
    };

    return {
        closest(selector) {
            if (selector === "[data-arrival-bell-token]") {
                return button;
            }
            if (selector === "[data-ship-combat-close]") {
                return null;
            }
            if (selector === "[data-ship-combat-row]") {
                return row;
            }
            if (selectorListContains(selector, "button") || selectorListContains(selector, "[data-fleet-row-control]")) {
                return button;
            }
            return null;
        },
    };
}

function dataSlotTokenFor(page, slotKey) {
    const matches = [...page.elements.view.innerHTML.matchAll(/data-slot-token="([^"]+)"/gu)];
    if (matches.length !== 1 || !matches[0]?.[1]) {
        throw new Error(`Expected one data-slot-token for ${slotKey}, found ${matches.length}`);
    }
    return matches[0][1];
}

function dataArrivalBellTokenFor(page) {
    const tokens = arrivalBellTokensFor(page);
    if (tokens.length !== 1 || !tokens[0]) {
        throw new Error(`Expected one data-arrival-bell-token, found ${tokens.length}`);
    }
    return tokens[0];
}

function arrivalBellTokensFor(page) {
    return [...page.elements.view.innerHTML.matchAll(/data-arrival-bell-token="([^"]+)"/gu)].map((match) => match[1]);
}

function selectorListContains(selector, expected) {
    return String(selector ?? "")
        .split(",")
        .map((part) => part.trim())
        .includes(expected);
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

function activityPayload(items = []) {
    return {
        ok: true,
        source: "fleet.activity.preview",
        provisional: true,
        stability: "preview",
        items,
    };
}

function alertIntentPayload(items = []) {
    return {
        ok: true,
        source: "fleet.alert_intents",
        dataSource: {
            source: "store",
            storageBackend: "sqlite",
            exists: true,
            eventTypes: ["fleet.alert_evidence"],
        },
        limit: 8,
        totalEvidenceEvents: items.length,
        returnedEvidenceEvents: items.length,
        schemaVersion: "stfc.sidecar.fleet-alert-intent-projection.v0",
        sourceEventCount: items.length,
        intentCount: items.length,
        skippedCount: 0,
        items,
        skipped: [],
    };
}

function combatPreviewPayload(matches = [], options = {}) {
    return {
        ok: true,
        source: "fleet.ship_recent_combat.preview",
        preview: {
            schema: "stfc.fleet.ship_recent_combat.preview.v1",
            provisional: true,
            matches,
            unmatchedBattles: options.unmatchedBattles ?? [],
            unmatchedFleetRows: options.unmatchedFleetRows ?? [],
        },
    };
}

function createMockAudioContext() {
    const calls = {
        instances: 0,
        resumes: 0,
        starts: 0,
        stops: 0,
    };

    return {
        calls,
        AudioContext: class MockAudioContext {
            constructor() {
                calls.instances += 1;
                this.currentTime = 0;
                this.destination = {};
            }

            resume() {
                calls.resumes += 1;
                return Promise.resolve();
            }

            createOscillator() {
                return {
                    type: "",
                    frequency: {
                        setValueAtTime() { },
                    },
                    connect() { },
                    start() {
                        calls.starts += 1;
                    },
                    stop() {
                        calls.stops += 1;
                    },
                };
            }

            createGain() {
                return {
                    gain: {
                        setValueAtTime() { },
                        exponentialRampToValueAtTime() { },
                    },
                    connect() { },
                };
            }
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
