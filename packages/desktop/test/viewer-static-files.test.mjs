import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolvePublicAsset, sendJson, sendText } from "../../viewer/server/static-files.mjs";

describe("viewer static file helpers", () => {
    let tempDir = "";

    afterEach(async () => {
        if (tempDir) {
            await rm(tempDir, { force: true, recursive: true });
            tempDir = "";
        }
    });

    it("resolves root and extensionless page paths inside the public directory", async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), "sidecar-public-"));
        const publicDir = path.join(tempDir, "public");
        await mkdir(publicDir);
        await writeFile(path.join(publicDir, "index.html"), "<!doctype html>", "utf8");
        await mkdir(path.join(publicDir, "settings"));
        await writeFile(path.join(publicDir, "settings", "index.html"), "<!doctype html>", "utf8");

        await expect(resolvePublicAsset(publicDir, "/")).resolves.toMatchObject({
            filePath: path.join(publicDir, "index.html"),
            contentType: "text/html; charset=utf-8",
        });
        await expect(resolvePublicAsset(publicDir, "/settings/")).resolves.toMatchObject({
            filePath: path.join(publicDir, "settings", "index.html"),
            contentType: "text/html; charset=utf-8",
        });
    });

    it("blocks static file traversal outside the public directory", async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), "sidecar-public-"));
        const publicDir = path.join(tempDir, "public");
        await mkdir(publicDir);
        await writeFile(path.join(publicDir, "index.html"), "<!doctype html>", "utf8");
        await writeFile(path.join(tempDir, "outside.txt"), "outside", "utf8");

        await expect(resolvePublicAsset(publicDir, "/../outside.txt")).resolves.toBeNull();
    });

    it("keeps response helper cache and content-type headers stable", () => {
        const jsonResponse = captureResponse();
        sendJson(jsonResponse, 201, { ok: true });
        expect(jsonResponse.statusCode).toBe(201);
        expect(jsonResponse.headers).toEqual({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        });
        expect(jsonResponse.body).toBe(JSON.stringify({ ok: true }));

        const textResponse = captureResponse();
        sendText(textResponse, 202, "accepted", "text/plain; charset=utf-8");
        expect(textResponse.statusCode).toBe(202);
        expect(textResponse.headers).toEqual({
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
        });
        expect(textResponse.body).toBe("accepted");
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
