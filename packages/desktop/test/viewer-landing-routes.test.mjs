import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { resolvePublicAsset } from "../../viewer/server/static-files.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../../viewer/public");

describe("viewer landing page routes", () => {
    test("serves /aria/ through static public asset resolution", async () => {
        await expect(resolvePublicAsset(publicDir, "/aria/")).resolves.toMatchObject({
            filePath: path.resolve(publicDir, "aria", "index.html"),
            contentType: "text/html; charset=utf-8",
        });
    });

    test("serves /setup/ through static public asset resolution", async () => {
        await expect(resolvePublicAsset(publicDir, "/setup/")).resolves.toMatchObject({
            filePath: path.resolve(publicDir, "setup", "index.html"),
            contentType: "text/html; charset=utf-8",
        });
    });

    test("serves /diagnostics/ through static public asset resolution", async () => {
        await expect(resolvePublicAsset(publicDir, "/diagnostics/")).resolves.toMatchObject({
            filePath: path.resolve(publicDir, "diagnostics", "index.html"),
            contentType: "text/html; charset=utf-8",
        });
    });

    test("serves /diagnostics/cloud-sync/ through static public asset resolution", async () => {
        await expect(resolvePublicAsset(publicDir, "/diagnostics/cloud-sync/")).resolves.toMatchObject({
            filePath: path.resolve(publicDir, "diagnostics", "cloud-sync", "index.html"),
            contentType: "text/html; charset=utf-8",
        });
    });

    test("keeps /majel/ resolving as a legacy compatibility route", async () => {
        await expect(resolvePublicAsset(publicDir, "/majel/")).resolves.toMatchObject({
            filePath: path.resolve(publicDir, "majel", "index.html"),
            contentType: "text/html; charset=utf-8",
        });
    });
});