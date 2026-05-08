import { describe, expect, test } from "vitest";

import {
    communityModInstallLabel,
    communityModInstallSummary,
    communityModInstallTone,
    communityModReleaseLabel,
    communityModReleaseSummary,
    communityModInstallPlanLabel,
    communityModInstallPlanSummary,
    communityModArtifactVerificationLabel,
    communityModArtifactVerificationSummary,
    communityModArtifactStagingLabel,
    communityModArtifactStagingSummary,
    communityModInstallConfirmationLabel,
    communityModInstallConfirmationSummary,
    communityModInstallExecutionLabel,
    communityModInstallExecutionRecoverySummary,
    communityModInstallExecutionSummary,
    communityModUninstallConfirmationLabel,
    communityModUninstallConfirmationSummary,
    communityModUninstallExecutionLabel,
    communityModUninstallExecutionRecoverySummary,
    communityModUninstallExecutionSummary,
    communityModUninstallPlanLabel,
    communityModUninstallPlanSummary,
    modProfileLabel,
} from "../../viewer/public/shared/community-mod-status.js";

describe("Community Mod status formatting", () => {
    test("formats official Basic installs with release evidence", () => {
        const install = {
            ok: true,
            state: "installed",
            classification: "netniv-basic",
            matchedRelease: {
                owner: "netniV",
                repo: "stfc-mod",
                tag: "v1.1.0",
            },
            dll: {
                sha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA",
                versionInfo: { fileVersion: "1.1.0.0" },
            },
        };

        expect(communityModInstallLabel(install)).toBe("Official Basic installed");
        expect(communityModInstallSummary(install)).toContain("netniV/stfc-mod v1.1.0");
        expect(communityModInstallSummary(install)).toContain("SHA-256 45DBE5FA43E2...");
        expect(communityModInstallTone(install)).toBe("info");
    });

    test("treats unknown DLLs as warning status", () => {
        const install = {
            ok: true,
            state: "installed",
            classification: "unknown",
            dll: { sha256: "D0F1418D61803762F8AA2DDC2F8C807616C8FA20D2437A32C4358B1DE7AD6961" },
        };

        expect(communityModInstallLabel(install)).toBe("Unknown version.dll installed");
        expect(communityModInstallTone(install)).toBe("warning");
    });

    test("formats unsupported install platforms without implying Windows probes", () => {
        const install = {
            ok: true,
            state: "unsupported_platform",
            summary: "macOS Community Mod install/update is not implemented yet.",
        };

        expect(communityModInstallLabel(install)).toBe("Platform unsupported");
        expect(communityModInstallSummary(install)).toBe("macOS Community Mod install/update is not implemented yet.");
        expect(communityModInstallTone(install)).toBe("warning");
    });

    test("formats mod release catalog states", () => {
        const catalog = {
            ok: true,
            profile: "netniv-basic",
            repository: "netniV/stfc-mod",
            status: "ready",
            installSupported: true,
            release: {
                version: "1.1.0",
                tagName: "v1.1.0",
                htmlUrl: "https://github.com/netniV/stfc-mod/releases/tag/v1.1.0",
            },
            windowsAsset: {
                name: "stfc-community-mod-v1.1.0.zip",
                digest: "sha256:945e73f7a122e4d7c374a1e5bb847339c2831dd6390b8b907e991a993e9797ea",
            },
        };

        expect(communityModReleaseLabel(catalog)).toBe("1.1.0 ready");
        expect(communityModReleaseSummary(catalog)).toContain("stfc-community-mod-v1.1.0.zip");
        expect(modProfileLabel("netniv-basic")).toBe("Official Basic");
    });

    test("keeps Guff Advanced release metadata distinct from install support", () => {
        const catalog = {
            ok: true,
            profile: "guff-advanced",
            repository: "Guffawaffle/stfc-mod",
            status: "ready",
            installSupported: false,
            unsupportedReason: "Install disabled until release marker exists.",
            release: { tagName: "v1.0.0-guffa.8" },
            windowsAsset: { name: "version.dll" },
        };

        expect(communityModReleaseLabel(catalog)).toBe("Guff Advanced metadata ready");
        expect(communityModReleaseSummary(catalog)).toContain("Install disabled until release marker exists.");
    });

    test("formats install/update plans without implying execution is enabled", () => {
        const plan = {
            ok: true,
            status: "update_available",
            action: "update",
            actionLabel: "Update available",
            summary: "v1.1.0 is newer than installed v1.0.0.",
            target: { tag: "v1.1.0", assetName: "stfc-community-mod-v1.1.0.zip" },
            execution: { enabled: false },
            warnings: [],
        };

        expect(communityModInstallPlanLabel(plan)).toBe("Update available");
        expect(communityModInstallPlanSummary(plan)).toContain("Manual confirmation path not enabled yet");
    });

    test("formats unsupported install/update platforms", () => {
        const plan = {
            ok: true,
            status: "platform_unsupported",
            action: "none",
            summary: "macOS Community Mod install/update is not implemented yet.",
            warnings: [],
        };
        const execution = {
            ok: true,
            status: "platform_unsupported",
            summary: "macOS Community Mod install/update is not implemented yet.",
            safety: { writesGameDirectory: false },
            execution: { writesAttempted: false },
        };

        expect(communityModInstallPlanLabel(plan)).toBe("Platform unsupported");
        expect(communityModInstallPlanSummary(plan)).toBe("macOS Community Mod install/update is not implemented yet.");
        expect(communityModInstallExecutionLabel(execution)).toBe("Platform unsupported");
        expect(communityModInstallExecutionSummary(execution)).toContain("no game-directory write attempted");
    });

    test("formats verified artifacts without implying game-directory writes", () => {
        const verification = {
            ok: true,
            status: "verified",
            summary: "Community Mod artifact hash and structure verified.",
            artifact: {
                actualSha256: "945E73F7A122E4D7C374A1E5BB847339C2831DD6390B8B907E991A993E9797EA",
                inspection: { dllEntry: "version.dll" },
            },
            cache: { reused: false },
        };

        expect(communityModArtifactVerificationLabel(verification)).toBe("Artifact verified");
        expect(communityModArtifactVerificationSummary(verification)).toContain("SHA-256 945E73F7A122...");
        expect(communityModArtifactVerificationSummary(verification)).toContain("cached");
    });

    test("formats staged artifacts as sidecar-cache only", () => {
        const staging = {
            ok: true,
            status: "staged",
            summary: "Community Mod version.dll staged in the sidecar cache.",
            staged: {
                bytes: 10860032,
                dllSha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA",
            },
            safety: { writesGameDirectory: false },
        };

        expect(communityModArtifactStagingLabel(staging)).toBe("version.dll staged");
        expect(communityModArtifactStagingSummary(staging)).toContain("DLL SHA-256 45DBE5FA43E2...");
        expect(communityModArtifactStagingSummary(staging)).toContain("sidecar cache only");
    });

    test("formats install confirmation without implying copy execution", () => {
        const confirmation = {
            ok: true,
            status: "ready_for_confirmation",
            summary: "Replace unknown version.dll is ready for explicit user confirmation.",
            staged: { dllSha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA" },
            target: {
                destinationPath: "C:\\Games\\Star Trek Fleet Command\\default\\game\\version.dll",
                backupPath: "C:\\Games\\Star Trek Fleet Command\\default\\game\\.stfc-sidecar\\backups\\version.dll.bak",
            },
            execution: { enabled: false },
        };

        expect(communityModInstallConfirmationLabel(confirmation)).toBe("Confirmation ready");
        expect(communityModInstallConfirmationSummary(confirmation)).toContain("Staged SHA-256 45DBE5FA43E2...");
        expect(communityModInstallConfirmationSummary(confirmation)).toContain("Destination C:\\Games");
        expect(communityModInstallConfirmationSummary(confirmation)).toContain("copy disabled");
    });

    test("formats blocked install execution without implying writes", () => {
        const execution = {
            ok: true,
            status: "server_execution_disabled",
            summary: "Install execution endpoint is disabled for this process.",
            target: { destinationPath: "C:\\Games\\Star Trek Fleet Command\\default\\game\\version.dll" },
            safety: { writesGameDirectory: false },
            execution: { enabled: false, writesAttempted: false },
        };

        expect(communityModInstallExecutionLabel(execution)).toBe("Execution disabled");
        expect(communityModInstallExecutionSummary(execution)).toContain("no game-directory write attempted");
        expect(communityModInstallExecutionSummary(execution)).toContain("Destination C:\\Games");
        expect(communityModInstallExecutionRecoverySummary(execution)).toContain("No files were changed");
    });

    test("formats completed install execution with receipt details", () => {
        const execution = {
            ok: true,
            status: "installed",
            summary: "Installed Community Mod version.dll and verified the copied hash.",
            receipt: {
                destination: { dllSha256: "45DBE5FA43E23B05467A3FC3C7237DCD0C45EE0ED193658307B6001EC5508ACA" },
                backup: { created: false },
                manifest: { written: true, path: "C:\\Games\\Star Trek Fleet Command\\default\\game\\.stfc-sidecar\\community-mod-install.json" },
            },
            safety: { writesGameDirectory: true },
            execution: { writesAttempted: true },
        };

        expect(communityModInstallExecutionLabel(execution)).toBe("Community Mod installed");
        expect(communityModInstallExecutionSummary(execution)).toContain("Installed SHA-256 45DBE5FA43E2...");
        expect(communityModInstallExecutionSummary(execution)).toContain("Manifest C:\\Games");
        expect(communityModInstallExecutionRecoverySummary(execution)).toContain("remove version.dll");
    });

    test("formats replacement rollback instructions from execution receipts", () => {
        const execution = {
            ok: true,
            status: "replaced",
            summary: "Replaced Community Mod version.dll and verified the copied hash.",
            receipt: {
                backup: {
                    created: true,
                    path: "C:\\Games\\Star Trek Fleet Command\\default\\game\\.stfc-sidecar\\backups\\version.dll.bak",
                },
            },
            safety: { writesGameDirectory: true },
            execution: { writesAttempted: true, writesCompleted: true },
        };

        expect(communityModInstallExecutionRecoverySummary(execution)).toContain("Rollback available");
        expect(communityModInstallExecutionRecoverySummary(execution)).toContain("version.dll.bak");
    });

    test("formats failed execution rollback outcomes", () => {
        const restored = {
            ok: false,
            status: "execution_failed",
            summary: "copy failed",
            rollback: { attempted: true, restoredBackup: true },
            safety: { writesGameDirectory: true },
            execution: { writesAttempted: true },
        };
        const manual = {
            ok: false,
            status: "execution_failed",
            summary: "copy failed",
            target: {
                backupPath: "C:\\Games\\Star Trek Fleet Command\\default\\game\\.stfc-sidecar\\backups\\version.dll.bak",
            },
            rollback: { attempted: true, error: "access denied" },
            safety: { writesGameDirectory: true },
            execution: { writesAttempted: true },
        };

        expect(communityModInstallExecutionRecoverySummary(restored)).toContain("restored the previous version.dll");
        expect(communityModInstallExecutionRecoverySummary(manual)).toContain("manual attention");
        expect(communityModInstallExecutionRecoverySummary(manual)).toContain("version.dll.bak");
    });

    test("formats uninstall plan, confirmation, and execution receipts", () => {
        const plan = {
            ok: true,
            status: "unknown_install_removable",
            action: "remove_unknown",
            summary: "Unknown version.dll can be removed.",
            target: {
                destinationPath: "C:\\Games\\Star Trek Fleet Command\\default\\game\\version.dll",
            },
            settings: { policy: "leave_in_place", preserve: true, delete: false },
            warnings: ["Unknown DLL provenance."],
        };
        const confirmation = {
            ok: true,
            status: "ready_for_confirmation",
            summary: "version.dll removal is ready.",
            current: { dllSha256: "D0F1418D61803762F8AA2DDC2F8C807616C8FA20D2437A32C4358B1DE7AD6961" },
            target: plan.target,
            settings: { policy: "leave_in_place", preserve: true, delete: false },
        };
        const execution = {
            ok: true,
            status: "removed",
            summary: "Removed version.dll.",
            receipt: {
                destination: { dllSha256: "D0F1418D61803762F8AA2DDC2F8C807616C8FA20D2437A32C4358B1DE7AD6961" },
                backup: { path: "" },
                settings: { policy: "delete_settings_and_logs", preserved: false, deleted: true, touched: true, deletedCount: 4 },
            },
            safety: { writesGameDirectory: true },
            execution: { writesAttempted: true, writesCompleted: true },
        };

        expect(communityModUninstallPlanLabel(plan)).toBe("Removal available");
        expect(communityModUninstallPlanSummary(plan)).not.toContain("Backup");
        expect(communityModUninstallPlanSummary(plan)).toContain("Settings/logs left untouched");
        expect(communityModUninstallConfirmationLabel(confirmation)).toBe("Uninstall confirmation ready");
        expect(communityModUninstallConfirmationSummary(confirmation)).toContain("Current SHA-256 D0F1418D6180...");
        expect(communityModUninstallConfirmationSummary(confirmation)).toContain("Settings/logs left untouched");
        expect(communityModUninstallExecutionLabel(execution)).toBe("Community Mod removed");
        expect(communityModUninstallExecutionSummary(execution)).not.toContain("Backup C:\\Games");
        expect(communityModUninstallExecutionSummary(execution)).toContain("Settings/logs deleted (4 files)");
        expect(communityModUninstallExecutionRecoverySummary(execution)).toContain("Fresh sidecar install was removed");
    });
});