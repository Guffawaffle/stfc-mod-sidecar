const path = require("node:path");
const { spawnSync } = require("node:child_process");

module.exports = async function signWithAzureCli(configuration) {
    const script = path.join(__dirname, "trusted-signing.ps1");
    const result = spawnSync(
        "pwsh",
        [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            script,
            "-File",
            configuration.path,
            "-FileDigest",
            configuration.hash,
        ],
        {
            stdio: "inherit",
            windowsHide: true,
        },
    );

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`Azure Artifact Signing failed for ${configuration.path} (exit ${result.status})`);
    }
};
