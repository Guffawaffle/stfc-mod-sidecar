import fs from "node:fs/promises";
import path from "node:path";

export const STFC_GAME_EXECUTABLE = "prime.exe";
export const STFC_GAME_REQUIRED_FILES = Object.freeze(["GameAssembly.dll", "UnityPlayer.dll"]);
export const STFC_GAME_REQUIRED_DIRECTORIES = Object.freeze(["prime_Data"]);
export const SECURITY_MOTTO = "Security is Paramount";

export async function detectDefaultStfcGameDirectory(options = {}) {
    const envGameDirectory = options.env?.STFC_SIDECAR_GAME_DIR ? path.resolve(options.env.STFC_SIDECAR_GAME_DIR) : "";
    for (const candidate of defaultStfcGameDirectoryCandidates(options.env ?? process.env)) {
        const validation = await validateStfcGameDirectory(candidate);
        if (validation.ok) {
            return {
                ...validation,
                detected: true,
                source: candidate === envGameDirectory ? "environment" : "default_path",
            };
        }
    }

    return null;
}

export function defaultStfcGameDirectoryCandidates(env = process.env) {
    const candidates = [];
    const add = (candidate) => {
        if (typeof candidate === "string" && candidate.trim()) {
            candidates.push(candidate.trim());
        }
    };

    add(env.STFC_SIDECAR_GAME_DIR);

    const systemDrive = typeof env.SystemDrive === "string" && env.SystemDrive.trim()
        ? env.SystemDrive.trim()
        : process.platform === "win32"
            ? "C:"
            : "";
    add(systemDrive ? path.join(systemDrive, "Games", "Star Trek Fleet Command", "default", "game") : "");
    add(env.ProgramFiles ? path.join(env.ProgramFiles, "Star Trek Fleet Command", "default", "game") : "");
    add(env["ProgramFiles(x86)"] ? path.join(env["ProgramFiles(x86)"], "Star Trek Fleet Command", "default", "game") : "");

    return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

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

    for (const requiredFile of STFC_GAME_REQUIRED_FILES) {
        const fileResult = await validateDirectChildFile(gameDirectory, requiredFile);
        if (!fileResult.ok) {
            return fileResult;
        }
    }

    for (const requiredDirectory of STFC_GAME_REQUIRED_DIRECTORIES) {
        const directoryResult = await validateDirectChildDirectory(gameDirectory, requiredDirectory);
        if (!directoryResult.ok) {
            return directoryResult;
        }
    }

    return {
        ok: true,
        gameDirectory,
        executablePath,
        requiredExecutable: STFC_GAME_EXECUTABLE,
        requiredFiles: STFC_GAME_REQUIRED_FILES,
        requiredDirectories: STFC_GAME_REQUIRED_DIRECTORIES,
        securityMotto: SECURITY_MOTTO,
    };
}

async function validateDirectChildFile(gameDirectory, fileName) {
    const candidate = path.join(gameDirectory, fileName);
    let fileStat;
    let filePath;
    try {
        fileStat = await fs.stat(candidate);
        filePath = await fs.realpath(candidate);
    } catch {
        return invalid("missing_stfc_file", `Selected folder is not an STFC game directory. ${fileName} was not found directly inside it.`);
    }

    if (!fileStat.isFile()) {
        return invalid("stfc_file_not_file", `${fileName} exists but is not a file.`);
    }

    if (!isDirectChildNamed(gameDirectory, filePath, fileName)) {
        return invalid("stfc_file_outside_directory", `${fileName} must resolve directly inside the selected game directory.`);
    }

    return { ok: true };
}

async function validateDirectChildDirectory(gameDirectory, directoryName) {
    const candidate = path.join(gameDirectory, directoryName);
    let directoryStat;
    let directoryPath;
    try {
        directoryStat = await fs.stat(candidate);
        directoryPath = await fs.realpath(candidate);
    } catch {
        return invalid("missing_stfc_directory", `Selected folder is not an STFC game directory. ${directoryName} was not found directly inside it.`);
    }

    if (!directoryStat.isDirectory()) {
        return invalid("stfc_directory_not_directory", `${directoryName} exists but is not a directory.`);
    }

    if (!isDirectChildNamed(gameDirectory, directoryPath, directoryName)) {
        return invalid("stfc_directory_outside_directory", `${directoryName} must resolve directly inside the selected game directory.`);
    }

    return { ok: true };
}

function invalid(code, error) {
    return {
        ok: false,
        code,
        error,
        requiredExecutable: STFC_GAME_EXECUTABLE,
        requiredFiles: STFC_GAME_REQUIRED_FILES,
        requiredDirectories: STFC_GAME_REQUIRED_DIRECTORIES,
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