import { sendJson } from "../static-files.mjs";

export async function handleModUninstallRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/mod/uninstall-plan") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        try {
            sendJson(response, 200, context.buildCommunityModUninstallPlan({
                install: await context.readCommunityModInstallStatus(),
            }));
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/uninstall-confirmation") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        let payload;
        try {
            payload = await context.readOptionalJsonBody(request);
        } catch (error) {
            sendJson(response, 400, invalidRequestResponse(error));
            return true;
        }

        try {
            sendJson(response, 200, await context.buildCurrentCommunityModUninstallConfirmation({
                deleteSettingsAndLogs: payload.deleteSettingsAndLogs === true,
            }));
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/uninstall-execution") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        let payload;
        try {
            payload = await context.readJsonBody(request);
        } catch (error) {
            sendJson(response, 400, invalidRequestResponse(error));
            return true;
        }

        try {
            await context.withCommunityModOperationLock(response, "uninstall", async () => {
                const confirmation = await context.buildCurrentCommunityModUninstallConfirmation({
                    deleteSettingsAndLogs: payload.deleteSettingsAndLogs === true,
                });
                if (confirmation.status !== "ready_for_confirmation") {
                    sendJson(response, 200, context.buildCommunityModUninstallExecutionBlocked({
                        confirmation,
                        executionRequest: {
                            ok: true,
                            status: confirmation.status,
                            summary: confirmation.summary,
                            warnings: ["Uninstall execution is blocked by confirmation preflight."],
                        },
                    }));
                    return;
                }

                const executionRequest = context.buildCommunityModUninstallExecutionRequest({
                    payload,
                    confirmation,
                    env: context.process.env,
                });
                if (executionRequest.status !== "ready") {
                    sendJson(response, 200, context.buildCommunityModUninstallExecutionBlocked({ confirmation, executionRequest }));
                    return;
                }

                const result = await context.executeCommunityModUninstall({
                    confirmation,
                    gameProcess: await context.detectStfcGameProcess({ gameDirectory: context.gameDir }),
                    enableExecution: true,
                });
                await context.refreshCommunityModVariantGate();
                sendJson(response, 200, result);
            });
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    return false;
}

function invalidRequestResponse(error) {
    return {
        ok: false,
        status: "invalid_request",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
    };
}

function errorResponse(error) {
    return {
        ok: false,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
    };
}
