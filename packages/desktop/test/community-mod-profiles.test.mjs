import { describe, expect, test } from "vitest";

import {
    COMMUNITY_MOD_RELEASE_PROFILES,
    DEFAULT_COMMUNITY_MOD_PROFILE,
    buildCommunityModProfileCapabilities,
    communityModProfileFromDistribution,
    normalizeCommunityModProfile,
} from "../../viewer/community-mod-profiles.mjs";

describe("community mod profiles", () => {
    test("defaults selected intent to Basic", () => {
        expect(DEFAULT_COMMUNITY_MOD_PROFILE).toBe("netniv-basic");
        expect(normalizeCommunityModProfile(undefined)).toBe("netniv-basic");
        expect(normalizeCommunityModProfile("surprise")).toBe("netniv-basic");
    });

    test("normalizes aliases without treating unknown installed distributions as known", () => {
        expect(normalizeCommunityModProfile("official")).toBe("netniv-basic");
        expect(normalizeCommunityModProfile("waffle")).toBe("waffle-basic");
        expect(normalizeCommunityModProfile("alpha")).toBe("waffle-advanced");
        expect(normalizeCommunityModProfile("rc")).toBe("waffle-advanced");
        expect(normalizeCommunityModProfile("unknown")).toBe("netniv-basic");
        expect(communityModProfileFromDistribution("waffle-basic")).toBe("waffle-basic");
        expect(communityModProfileFromDistribution("advanced-alpha")).toBe("waffle-advanced");
        expect(communityModProfileFromDistribution("unknown")).toBeNull();
    });

    test("keeps release metadata and capability declarations together", () => {
        expect(COMMUNITY_MOD_RELEASE_PROFILES["netniv-basic"].repository).toBe("netniV/stfc-mod");
        expect(COMMUNITY_MOD_RELEASE_PROFILES["waffle-basic"].distribution).toBe("waffle-basic");
        expect(COMMUNITY_MOD_RELEASE_PROFILES["waffle-advanced"].channel).toBe("alpha");
        expect(COMMUNITY_MOD_RELEASE_PROFILES["waffle-advanced"].distribution).toBe("advanced-alpha");
        expect(buildCommunityModProfileCapabilities("netniv-basic").battleLog).toBe(false);
        expect(buildCommunityModProfileCapabilities("waffle-basic").notifications).toBe(true);
        expect(buildCommunityModProfileCapabilities("waffle-basic").battleLog).toBe(false);
        expect(buildCommunityModProfileCapabilities("waffle-advanced").battleLog).toBe(true);
    });
});