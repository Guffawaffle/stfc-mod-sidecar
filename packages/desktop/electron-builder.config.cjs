const path = require("node:path");

const ELECTRON_VERSION = "41.5.0";
const DEFAULT_TIMESTAMP_SERVER = "http://timestamp.digicert.com";

const signingMode = (process.env.WIN_SIGN_MODE ?? "unsigned").trim().toLowerCase();
const validSigningModes = new Set(["unsigned", "azure", "cert-store"]);

if (!validSigningModes.has(signingMode)) {
    throw new Error(`Unsupported WIN_SIGN_MODE: ${signingMode}. Expected unsigned, azure, or cert-store.`);
}

const useAzureSigning = signingMode === "azure";
const useCertStoreSigning = signingMode === "cert-store";
const shouldSignAndEditExecutable = useAzureSigning || useCertStoreSigning || process.env.WIN_SIGN_AND_EDIT_EXECUTABLE === "true";
const publisherName = shouldSignAndEditExecutable ? requiredEnv("WIN_PUBLISHER_NAME") : process.env.WIN_PUBLISHER_NAME;

module.exports = {
    appId: "dev.guffawaffle.stfc-mod-sidecar",
    productName: "STFC Community Mod Companion",
    electronVersion: ELECTRON_VERSION,
    asar: false,
    directories: {
        output: "dist",
    },
    files: ["src/**/*", "package.json"],
    extraResources: [
        {
            from: "../viewer",
            to: "viewer",
            filter: ["**/*", "!node_modules/**"],
        },
        {
            from: "../core/dist",
            to: "core/dist",
        },
        {
            from: "../core/package.json",
            to: "core/package.json",
        },
        {
            from: "../../node_modules",
            to: "node_modules",
            filter: [
                "pg/**/*",
                "pg-cloudflare/**/*",
                "pg-connection-string/**/*",
                "pg-int8/**/*",
                "pg-pool/**/*",
                "pg-protocol/**/*",
                "pg-types/**/*",
                "pgpass/**/*",
                "postgres-array/**/*",
                "postgres-bytea/**/*",
                "postgres-date/**/*",
                "postgres-interval/**/*",
                "smol-toml/**/*",
                "split2/**/*",
                "xtend/**/*",
            ],
        },
    ],
    win: {
        target: [
            {
                target: "nsis",
                arch: ["x64"],
            },
            {
                target: "portable",
                arch: ["x64"],
            },
        ],
        signAndEditExecutable: shouldSignAndEditExecutable,
        ...(useAzureSigning
            ? {
                azureSignOptions: {
                    publisherName,
                    endpoint: requiredEnv("AZURE_TRUSTED_SIGNING_ENDPOINT"),
                    certificateProfileName: requiredEnv("AZURE_CERTIFICATE_PROFILE_NAME"),
                    codeSigningAccountName: requiredEnv("AZURE_CODE_SIGNING_ACCOUNT_NAME"),
                    fileDigest: "SHA256",
                    timestampDigest: "SHA256",
                    timestampRfc3161: "http://timestamp.acs.microsoft.com",
                },
            }
            : {}),
        ...(useCertStoreSigning
            ? {
                signtoolOptions: {
                    publisherName,
                    certificateSha1: requiredEnv("WIN_CERT_SHA1"),
                    signingHashAlgorithms: ["sha256"],
                    rfc3161TimeStampServer: process.env.WIN_TIMESTAMP_SERVER ?? DEFAULT_TIMESTAMP_SERVER,
                },
            }
            : {}),
    },
    nsis: {
        artifactName: "${productName}-Setup-${version}-${arch}.${ext}",
        include: path.join(__dirname, "build", "installer.nsh"),
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
    },
    portable: {
        artifactName: "${productName}-Portable-${version}-${arch}.${ext}",
    },
    mac: {
        target: ["dmg"],
        category: "public.app-category.utilities",
    },
};

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} must be set when WIN_SIGN_MODE=${signingMode}`);
    }

    return value;
}