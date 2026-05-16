import { sendJson } from "../static-files.mjs";

export async function handleModInstallRoutes(request, response, requestUrl, context) {
    if (requestUrl.pathname === "/api/mod/release-catalog") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        try {
            sendJson(response, 200, await context.fetchCommunityModReleaseCatalog({
                profile: selectedProfile(requestUrl, context),
            }));
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/install-plan") {
        if (request.method && request.method !== "GET") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        try {
            const profile = selectedProfile(requestUrl, context);
            const [install, catalog] = await Promise.all([
                context.readCommunityModInstallStatus(),
                context.fetchCommunityModReleaseCatalog({ profile }),
            ]);
            sendJson(response, 200, context.buildCommunityModInstallPlan({ profile, install, catalog }));
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/verify-artifact") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        try {
            const profile = selectedProfile(requestUrl, context);
            const catalog = await context.fetchCommunityModReleaseCatalog({ profile });
            sendJson(response, 200, await context.verifyCommunityModArtifact({
                catalog,
                cacheDir: artifactCacheDir(context),
            }));
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/install-preflight") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        try {
            const profile = selectedProfile(requestUrl, context);
            const [install, catalog] = await Promise.all([
                context.readCommunityModInstallStatus(),
                context.fetchCommunityModReleaseCatalog({ profile }),
            ]);
            const installPlan = context.buildCommunityModInstallPlan({ profile, install, catalog });
            const gameProcess = await context.detectStfcGameProcess({ gameDirectory: context.gameDir });
            let preflight = context.buildCommunityModInstallPreflight({ installPlan, gameProcess });
            if (preflight.status === "artifact_not_verified") {
                const artifactVerification = await context.verifyCommunityModArtifact({
                    catalog,
                    cacheDir: artifactCacheDir(context),
                });
                preflight = context.buildCommunityModInstallPreflight({ installPlan, artifactVerification, gameProcess });
            }

            sendJson(response, 200, preflight);
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/stage-artifact") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        try {
            const profile = selectedProfile(requestUrl, context);
            const catalog = await context.fetchCommunityModReleaseCatalog({ profile });
            const cacheDir = artifactCacheDir(context);
            const verification = await context.verifyCommunityModArtifact({ catalog, cacheDir });
            sendJson(response, 200, await context.stageCommunityModArtifact({ catalog, verification, cacheDir }));
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/install-confirmation") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        try {
            sendJson(response, 200, await context.buildCurrentCommunityModInstallConfirmation(
                selectedProfile(requestUrl, context),
            ));
        } catch (error) {
            sendJson(response, 502, errorResponse(error));
        }
        return true;
    }

    if (requestUrl.pathname === "/api/mod/install-execution") {
        if (request.method !== "POST") {
            sendJson(response, 405, { ok: false, error: "Method not allowed" });
            return true;
        }

        let payload;
        try {
            payload = await context.readJsonBody(request);
        } catch (error) {
            sendJson(response, 400, {
                ok: false,
                status: "invalid_request",
                error: error instanceof Error ? error.message : String(error),
                checkedAt: new Date().toISOString(),
            });
            return true;
        }

        try {
            await context.withCommunityModOperationLock(response, "install", async () => {
                const profile = selectedProfile(requestUrl, context);
                const confirmation = await context.buildCurrentCommunityModInstallConfirmation(profile);
                if (confirmation.status !== "ready_for_confirmation") {
                    sendJson(response, 200, context.buildCommunityModInstallExecutionBlocked({
                        confirmation,
                        executionRequest: {
                            ok: true,
                            status: confirmation.status,
                            summary: confirmation.summary,
                            warnings: ["Install execution is blocked by confirmation preflight."],
                        },
                    }));
                    return;
                }

                const executionRequest = context.buildCommunityModInstallExecutionRequest({
                    payload,
                    confirmation,
                    env: context.process.env,
                });
                if (executionRequest.status !== "ready") {
                    sendJson(response, 200, context.buildCommunityModInstallExecutionBlocked({ confirmation, executionRequest }));
                    return;
                }

                const result = await context.executeCommunityModInstall({
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

function selectedProfile(requestUrl, context) {
    return context.normalizeCommunityModReleaseProfile(
        requestUrl.searchParams.get("profile") ?? context.communityModSettingsProfile,
    );
}

function artifactCacheDir(context) {
    return context.process.env.STFC_SIDECAR_CACHE_DIR || context.defaultArtifactCacheDir;
}

function errorResponse(error) {
    return {
        ok: false,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
    };
}
