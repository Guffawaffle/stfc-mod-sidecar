export const COMMUNITY_MOD_PROFILE_NETNIV_BASIC = "netniv-basic";
export const COMMUNITY_MOD_PROFILE_WAFFLE_BASIC = "waffle-basic";
export const COMMUNITY_MOD_PROFILE_WAFFLE_ADVANCED = "waffle-advanced";
export const DEFAULT_COMMUNITY_MOD_PROFILE = COMMUNITY_MOD_PROFILE_NETNIV_BASIC;

export const COMMUNITY_MOD_PROFILE_DEFINITIONS = Object.freeze({
    [COMMUNITY_MOD_PROFILE_NETNIV_BASIC]: Object.freeze({
        profile: COMMUNITY_MOD_PROFILE_NETNIV_BASIC,
        label: "Basic",
        distribution: "official-basic",
        aliases: Object.freeze(["netniv-basic", "netniv", "official", "official-basic", "basic"]),
        release: Object.freeze({
            repository: "netniV/stfc-mod",
            channel: "stable",
            installSupported: true,
        }),
        capabilities: Object.freeze({
            settings: true,
            installStatus: true,
            notifications: false,
            battleLog: false,
            eventStore: false,
        }),
    }),
    [COMMUNITY_MOD_PROFILE_WAFFLE_BASIC]: Object.freeze({
        profile: COMMUNITY_MOD_PROFILE_WAFFLE_BASIC,
        label: "Waffle Basic",
        distribution: "waffle-basic",
        aliases: Object.freeze(["waffle-basic", "waffle", "waffle-notifications", "guff-basic"]),
        release: Object.freeze({
            repository: "Guffawaffle/stfc-mod",
            channel: "alpha",
            installSupported: true,
        }),
        capabilities: Object.freeze({
            settings: true,
            installStatus: true,
            notifications: true,
            battleLog: false,
            eventStore: false,
        }),
    }),
    [COMMUNITY_MOD_PROFILE_WAFFLE_ADVANCED]: Object.freeze({
        profile: COMMUNITY_MOD_PROFILE_WAFFLE_ADVANCED,
        label: "Waffle Advanced",
        distribution: "advanced-alpha",
        aliases: Object.freeze(["waffle-advanced", "waffle-dev", "guff-advanced", "guff", "advanced", "alpha", "advanced-alpha", "rc", "release-candidate"]),
        release: Object.freeze({
            repository: "Guffawaffle/stfc-mod",
            channel: "alpha",
            installSupported: true,
        }),
        capabilities: Object.freeze({
            settings: true,
            installStatus: true,
            notifications: true,
            battleLog: true,
            eventStore: true,
        }),
    }),
});

export const COMMUNITY_MOD_RELEASE_PROFILES = Object.freeze(Object.fromEntries(
    Object.values(COMMUNITY_MOD_PROFILE_DEFINITIONS).map((definition) => [definition.profile, Object.freeze({
        profile: definition.profile,
        distribution: definition.distribution,
        repository: definition.release.repository,
        channel: definition.release.channel,
        installSupported: definition.release.installSupported,
    })]),
));

const RESERVED_SELECTED_PROFILE_ALIASES = Object.freeze({
    none: COMMUNITY_MOD_PROFILE_NETNIV_BASIC,
    unknown: COMMUNITY_MOD_PROFILE_NETNIV_BASIC,
    external: COMMUNITY_MOD_PROFILE_NETNIV_BASIC,
});

const PROFILE_ALIASES = Object.freeze(Object.fromEntries(
    Object.values(COMMUNITY_MOD_PROFILE_DEFINITIONS).flatMap((definition) => [
        [definition.profile, definition.profile],
        [definition.distribution, definition.profile],
        ...definition.aliases.map((alias) => [alias, definition.profile]),
    ]),
));

export function normalizeCommunityModProfile(value, options = {}) {
    const profile = communityModProfileFromAlias(value, { includeReserved: true });
    if (profile) {
        return profile;
    }

    if (options.fallback === null) {
        return null;
    }

    return communityModProfileFromAlias(options.fallback, { includeReserved: true }) ?? DEFAULT_COMMUNITY_MOD_PROFILE;
}

export function communityModProfileFromDistribution(value) {
    return communityModProfileFromAlias(value, { includeReserved: false });
}

export function isKnownCommunityModProfile(value) {
    return Boolean(COMMUNITY_MOD_PROFILE_DEFINITIONS[value]);
}

export function communityModProfileDefinition(value) {
    const profile = normalizeCommunityModProfile(value);
    return COMMUNITY_MOD_PROFILE_DEFINITIONS[profile];
}

export function buildCommunityModProfileCapabilities(value) {
    return { ...communityModProfileDefinition(value).capabilities };
}

export function profileFamiliesMatch(leftValue, rightValue) {
    const left = normalizeCommunityModProfile(leftValue, { fallback: null });
    const right = normalizeCommunityModProfile(rightValue, { fallback: null });
    if (!left || !right) {
        return false;
    }

    return profileFamily(left) === profileFamily(right);
}

export function profileFamily(value) {
    const profile = normalizeCommunityModProfile(value);
    return profile.startsWith("waffle-") ? "waffle" : profile;
}

function communityModProfileFromAlias(value, options = {}) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) {
        return null;
    }

    if (options.includeReserved && RESERVED_SELECTED_PROFILE_ALIASES[normalized]) {
        return RESERVED_SELECTED_PROFILE_ALIASES[normalized];
    }

    return PROFILE_ALIASES[normalized] ?? null;
}