import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronPath from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const skipStop = process.argv.includes("--skip-stop");

if (!skipStop) {
    run(resolveNpmInvocation(["run", "server:stop"]), { allowFailure: false });
}

run(resolveNpmInvocation(["run", "build", "--workspace", "@stfc-mod-sidecar/core"]), { allowFailure: false });

const electronEnv = { ...process.env };
delete electronEnv.ELECTRON_RUN_AS_NODE;

run({
    command: electronPath,
    args: [path.join(repoRoot, "packages", "desktop", "src", "main.mjs")],
    env: electronEnv,
}, { allowFailure: false });

function run(invocation, options) {
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: repoRoot,
        env: invocation.env ?? process.env,
        stdio: "inherit",
        shell: false,
    });

    if (result.error) {
        console.error(`[desktop-dev] ${result.error.message}`);
        process.exit(1);
    }

    if (!options.allowFailure && result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

function resolveNpmInvocation(args) {
    const npmExecPath = process.env.npm_execpath;
    if (npmExecPath) {
        return {
            command: process.execPath,
            args: [npmExecPath, ...args],
        };
    }

    return {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        args,
    };
}
