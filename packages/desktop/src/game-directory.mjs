import fs from "node:fs/promises";
import path from "node:path";

export const STFC_GAME_EXECUTABLE = "prime.exe";
export const SECURITY_MOTTO = "Security is Paramount";

export async function validateStfcGameDirectory(candidatePath) {
    const candidate = typeof candidatePath === "string" ? candidatePath.trim() : "";
    if (!candidate) {
        return invalid("empty", `Select the STFC game directory that contains ${STFC_GAME_EXECUTABLE}.`);
    }

    if (candidate.includes("\0")) {
        return invalid("invalid_path", "Selected directory path is invalid.");
    }

    if (!path.isAbsolute(candidate)) {
        return invalid("relative_path", "Selected directory must be an absolute local path.");
    }

    if (isWindowsNetworkOrNamespacePath(candidate)) {
        return invalid("non_local_path", "Network and Windows namespace paths are not accepted for the STFC game directory.");
    }

    const resolvedCandidate = path.resolve(candidate);
    let gameDirectory;
    try {
        gameDirectory = await fs.realpath(resolvedCandidate);
    } catch {
        return invalid("directory_not_found", `Selected directory was not found. Choose the folder that contains ${STFC_GAME_EXECUTABLE}.`);
    }

    if (isWindowsNetworkOrNamespacePath(gameDirectory)) {
        return invalid("non_local_path", "Selected directory resolved outside a local Windows filesystem path.");
    }

    let directoryStat;
    try {
        directoryStat = await fs.stat(gameDirectory);
    } catch {
        return invalid("directory_not_found", `Selected directory was not found. Choose the folder that contains ${STFC_GAME_EXECUTABLE}.`);
    }

    if (!directoryStat.isDirectory()) {
        return invalid("not_directory", `Selected path is not a directory. Choose the folder that contains ${STFC_GAME_EXECUTABLE}.`);
    }

    const executableCandidate = path.join(gameDirectory, STFC_GAME_EXECUTABLE);
    let executableStat;
    let executablePath;
    try {
        executableStat = await fs.stat(executableCandidate);
        executablePath = await fs.realpath(executableCandidate);
    } catch {
        return invalid("missing_prime", `Selected folder is not an STFC game directory. ${STFC_GAME_EXECUTABLE} was not found directly inside it.`);
    }

    if (!executableStat.isFile()) {
        return invalid("prime_not_file", `${STFC_GAME_EXECUTABLE} exists but is not a file.`);
    }

    if (!isDirectChildNamed(gameDirectory, executablePath, STFC_GAME_EXECUTABLE)) {
        return invalid("prime_outside_directory", `${STFC_GAME_EXECUTABLE} must resolve directly inside the selected game directory.`);
    }

    return {
        ok: true,
        gameDirectory,
        executablePath,
        requiredExecutable: STFC_GAME_EXECUTABLE,
        securityMotto: SECURITY_MOTTO,
    };
}

function invalid(code, error) {
    return {
        ok: false,
        code,
        error,
        requiredExecutable: STFC_GAME_EXECUTABLE,
        securityMotto: SECURITY_MOTTO,
    };
}

function isWindowsNetworkOrNamespacePath(value) {
    if (process.platform !== "win32") {
        return false;
    }

    const normalized = String(value).replaceAll("/", "\\");
    return normalized.startsWith("\\\\") || normalized.startsWith("\\??\\");
}

function isDirectChildNamed(parentDirectory, childPath, expectedName) {
    const relativePath = path.relative(parentDirectory, childPath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return false;
    }

    const segments = relativePath.split(/[\\/]+/).filter(Boolean);
    if (segments.length !== 1) {
        return false;
    }

    return process.platform === "win32"
        ? segments[0].toLowerCase() === expectedName.toLowerCase()
        : segments[0] === expectedName;
}