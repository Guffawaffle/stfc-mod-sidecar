import { describe, expect, it } from "vitest";

import {
    buildReleaseInfo,
    inferReleaseChannel,
    normalizeReleaseChannel,
    normalizeSignaturePolicy,
} from "../../viewer/release-info.mjs";

describe("release info", () => {
    it("infers alpha channel from alpha versions", () => {
        expect(inferReleaseChannel("0.0.1-Alpha")).toBe("alpha");
    });

    it("normalizes release channel aliases", () => {
        expect(normalizeReleaseChannel("production")).toBe("stable");
        expect(normalizeReleaseChannel("pre-release")).toBe("alpha");
    });

    it("uses unsigned local policy for unpackaged builds", () => {
        expect(buildReleaseInfo({ version: "0.0.1-Alpha", packaged: false })).toMatchObject({
            channel: "alpha",
            signaturePolicy: "local_unsigned",
            signedRelease: false,
        });
    });

    it("uses Authenticode policy for packaged builds", () => {
        expect(buildReleaseInfo({ version: "0.0.1-Alpha", packaged: true })).toMatchObject({
            channel: "alpha",
            signaturePolicy: "authenticode_required",
            signedRelease: true,
        });
    });

    it("normalizes signing provider names", () => {
        expect(normalizeSignaturePolicy("azure-trusted-signing")).toBe("authenticode_required");
    });
});