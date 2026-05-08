import { describe, expect, test } from "vitest";

import {
    COMMUNITY_MOD_RELEASE_PROFILES,
    DEFAULT_COMMUNITY_MOD_PROFILE,
    buildCommunityModProfileCapabilities,
    communityModProfileFromDistribution,
    normalizeCommunityModProfile,
} from "../../viewer/community-mod-profiles.mjs";

describe("community mod profiles", () => {
    test("defaults selected intent to Official Basic", () => {
        expect(DEFAULT_COMMUNITY_MOD_PROFILE).toBe("netniv-basic");
        expect(normalizeCommunityModProfile(undefined)).toBe("netniv-basic");
        expect(normalizeCommunityModProfile("surprise")).toBe("netniv-basic");
    });

    test("normalizes aliases without treating unknown installed distributions as known", () => {
        expect(normalizeCommunityModProfile("official")).toBe("netniv-basic");
        expect(normalizeCommunityModProfile("alpha")).toBe("guff-advanced");
        expect(normalizeCommunityModProfile("rc")).toBe("guff-advanced");
        expect(normalizeCommunityModProfile("unknown")).toBe("netniv-basic");
        expect(communityModProfileFromDistribution("advanced-alpha")).toBe("guff-advanced");
        expect(communityModProfileFromDistribution("unknown")).toBeNull();
    });

    test("keeps release metadata and capability declarations together", () => {
        expect(COMMUNITY_MOD_RELEASE_PROFILES["netniv-basic"].repository).toBe("netniV/stfc-mod");
        expect(COMMUNITY_MOD_RELEASE_PROFILES["guff-advanced"].channel).toBe("alpha");
        expect(COMMUNITY_MOD_RELEASE_PROFILES["guff-advanced"].distribution).toBe("advanced-alpha");
        expect(buildCommunityModProfileCapabilities("netniv-basic").battleLog).toBe(false);
        expect(buildCommunityModProfileCapabilities("guff-advanced").battleLog).toBe(true);
    });
});