import { describe, expect, it, vi } from "vitest";

import { handleObservedHostileRoutes } from "../../viewer/server/routes/observed-hostile-routes.mjs";

describe("viewer observed hostile routes", () => {
    it("delegates observed hostile catalog reads", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileCatalog: vi.fn(async (limit) => ({
                ok: true,
                detail: "observed-hostile-index",
                limit,
                entries: [{ key: "hull:3066099110", title: "Armada Carrier" }],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles?limit=25"),
            context,
        )).resolves.toBe(true);

        expect(context.readObservedHostileCatalog).toHaveBeenCalledWith(25);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            detail: "observed-hostile-index",
            entries: [{ key: "hull:3066099110", title: "Armada Carrier" }],
        });
    });

    it("delegates paged catalog entry reads with filters", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileCatalogEntries: vi.fn(async (options) => ({
                ok: true,
                detail: "observed-hostile-catalog-entries",
                options,
                items: [],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles/catalog-entries?limit=25&cursor=abc&status=ambiguous&reference=unknown&systemId=818257505&q=rom"),
            context,
        )).resolves.toBe(true);

        expect(context.readObservedHostileCatalogEntries).toHaveBeenCalledWith({
            limit: 25,
            cursor: "abc",
            sort: "latest_seen_desc",
            status: "ambiguous",
            reference: "unknown",
            systemId: "818257505",
            q: "rom",
        });
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toMatchObject({
            ok: true,
            detail: "observed-hostile-catalog-entries",
        });
    });

    it("delegates system observation reads", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileObservations: vi.fn(async (options) => ({
                ok: true,
                detail: "observed-hostile-observations",
                options,
                items: [],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles/observations?limit=10&q=system"),
            context,
        )).resolves.toBe(true);

        expect(context.readObservedHostileObservations).toHaveBeenCalledWith({
            limit: 10,
            cursor: "",
            sort: "latest_seen_desc",
            status: "",
            reference: "",
            systemId: "",
            q: "system",
        });
        expect(response.statusCode).toBe(200);
    });

    it("delegates observed hostile community report JSON reads", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileCommunityReport: vi.fn(async () => ({
                ok: true,
                protocolVersion: "stfc.observed-hostile.community-report.v1",
                summary: {
                    highConfidenceUntrackedCount: 1,
                    submissionReadyCount: 1,
                    readyForMaintainerReviewCount: 0,
                    needsIdentifierReviewCount: 0,
                },
                items: [{
                    observedKey: "hull:missing-high",
                    identity: { submissionReadiness: "submission_ready" },
                }],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles/community-report?format=json"),
            context,
        )).resolves.toBe(true);

        expect(context.readObservedHostileCommunityReport).toHaveBeenCalledOnce();
        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
        expect(JSON.parse(response.body)).toMatchObject({
            protocolVersion: "stfc.observed-hostile.community-report.v1",
            items: [{
                observedKey: "hull:missing-high",
                identity: { submissionReadiness: "submission_ready" },
            }],
        });
    });

    it("renders observed hostile community report Markdown", async () => {
        const context = {
            defaultLimit: 150,
            readObservedHostileCommunityReport: vi.fn(async () => ({
                ok: true,
                protocolVersion: "stfc.observed-hostile.community-report.v1",
                generatedAt: "2026-06-07T01:00:00.000Z",
                reference: { label: "stfc-space.hostiles 2026-06-05" },
                summary: {
                    highConfidenceUntrackedCount: 0,
                    submissionReadyCount: 0,
                    readyForMaintainerReviewCount: 0,
                    needsIdentifierReviewCount: 0,
                },
                items: [],
            })),
        };
        const response = captureResponse();

        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles/community-report?format=markdown"),
            context,
        )).resolves.toBe(true);

        expect(response.statusCode).toBe(200);
        expect(response.headers["content-type"]).toBe("text/markdown; charset=utf-8");
        expect(response.body).toContain("# Observed Hostile Community Report");
        expect(response.body).toContain("* Submission-ready unmapped with hullId: 0");
        expect(response.body).toContain("* Ready for maintainer review without hullId: 0");
        expect(response.body).toContain("* Needs identifier review: 0");
        expect(response.body).toContain("userLocaId is included below only as a maintainer-review identifier.");
        expect(response.body).toContain("No submission-ready unmapped hostiles found.");
        expect(response.body).toContain("No high-confidence unmapped hostiles are currently ready for maintainer review.");
        expect(response.body).toContain("No high-confidence unmapped observations currently need identifier review.");
    });

    it("keeps method gates for observed hostile routes", async () => {
        const response = captureResponse();
        await handleObservedHostileRoutes(
            { method: "POST" },
            response,
            new URL("http://127.0.0.1/api/observed-hostiles"),
            { defaultLimit: 150, readObservedHostileCatalog: vi.fn() },
        );

        expect(response.statusCode).toBe(405);
        expect(JSON.parse(response.body)).toEqual({ ok: false, error: "Method not allowed" });
    });

    it("ignores unrelated routes", async () => {
        await expect(handleObservedHostileRoutes(
            { method: "GET" },
            captureResponse(),
            new URL("http://127.0.0.1/api/events"),
            { defaultLimit: 150, readObservedHostileCatalog: vi.fn() },
        )).resolves.toBe(false);
    });
});

function captureResponse() {
    return {
        body: "",
        headers: null,
        statusCode: 0,
        writeHead(statusCode, headers) {
            this.statusCode = statusCode;
            this.headers = headers;
        },
        end(body) {
            this.body = body;
        },
    };
}
