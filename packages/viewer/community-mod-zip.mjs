import { inflateRawSync } from "node:zlib";

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

export function readCommunityModZipEntries(buffer) {
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) {
        throw new Error("Zip artifact does not contain an end-of-central-directory record");
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const entries = [];
    let offset = centralDirectoryOffset;
    for (let index = 0; index < totalEntries; index += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
            throw new Error("Zip artifact central directory is malformed");
        }

        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const fileNameStart = offset + 46;
        const fileNameEnd = fileNameStart + fileNameLength;
        if (fileNameEnd > buffer.length) {
            throw new Error("Zip artifact central directory entry is truncated");
        }

        entries.push({
            name: buffer.subarray(fileNameStart, fileNameEnd).toString("utf8").replaceAll("\\", "/"),
            flags: buffer.readUInt16LE(offset + 8),
            compressionMethod: buffer.readUInt16LE(offset + 10),
            compressedSize: buffer.readUInt32LE(offset + 20),
            uncompressedSize: buffer.readUInt32LE(offset + 24),
            localHeaderOffset: buffer.readUInt32LE(offset + 42),
        });
        offset = fileNameEnd + extraLength + commentLength;
    }

    return entries;
}

export function findExpectedDllEntry(entries, expectedDllName = "version.dll") {
    const expectedName = String(expectedDllName ?? "version.dll").toLowerCase();
    return entries.find((entry) => basename(entry.name).toLowerCase() === expectedName) ?? null;
}

export function extractZipEntry(buffer, entry, options = {}) {
    const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
    if (!entry || typeof entry !== "object") {
        throw new Error("Zip entry is required");
    }

    if (isUnsafeZipEntry(entry)) {
        throw new Error("Zip entry path is unsafe");
    }

    if (entry.flags & 0x01) {
        throw new Error("Encrypted zip entries are not supported");
    }

    if (entry.uncompressedSize > maxBytes) {
        throw new Error(`Zip entry exceeds ${maxBytes} bytes`);
    }

    const localHeaderOffset = entry.localHeaderOffset;
    if (localHeaderOffset + 30 > buffer.length) {
        throw new Error("Zip entry local header is truncated");
    }

    if (buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
        throw new Error("Zip entry local header is malformed");
    }

    const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buffer.length) {
        throw new Error("Zip entry compressed data is truncated");
    }

    const compressed = buffer.subarray(dataStart, dataEnd);
    let extracted;
    if (entry.compressionMethod === ZIP_METHOD_STORE) {
        extracted = Buffer.from(compressed);
    } else if (entry.compressionMethod === ZIP_METHOD_DEFLATE) {
        extracted = inflateRawSync(compressed);
    } else {
        throw new Error(`Unsupported zip compression method: ${entry.compressionMethod}`);
    }

    if (extracted.length !== entry.uncompressedSize) {
        throw new Error("Zip entry uncompressed size did not match central directory");
    }

    if (extracted.length > maxBytes) {
        throw new Error(`Zip entry exceeds ${maxBytes} bytes`);
    }

    return extracted;
}

export function isUnsafeZipEntry(entry) {
    const normalized = String(typeof entry === "string" ? entry : entry?.name ?? "").replaceAll("\\", "/");
    return normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || normalized.split("/").some((part) => part === "..");
}

function findEndOfCentralDirectory(buffer) {
    const minimumOffset = Math.max(0, buffer.length - 65557);
    for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
        if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
            return offset;
        }
    }

    return -1;
}

function basename(value) {
    const parts = String(value ?? "").replaceAll("\\", "/").split("/");
    return parts.at(-1) ?? "";
}