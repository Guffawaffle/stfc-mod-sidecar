import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function resolvePublicAsset(publicDir, pathname) {
    for (const relativePath of publicPathCandidates(pathname)) {
        const filePath = path.resolve(publicDir, `.${relativePath}`);
        if (!isWithinPublicDir(publicDir, filePath)) {
            continue;
        }

        try {
            const fileStat = await stat(filePath);
            if (!fileStat.isFile()) {
                continue;
            }

            return {
                filePath,
                contentType: contentTypeForPath(filePath),
            };
        } catch {
            continue;
        }
    }

    return null;
}

export async function sendFile(response, filePath, contentType) {
    try {
        const body = await readFile(filePath);
        response.writeHead(200, {
            "content-type": contentType,
            "cache-control": "no-store",
        });
        response.end(body);
    } catch (error) {
        sendJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export function sendJson(response, statusCode, value) {
    response.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
    });
    response.end(JSON.stringify(value));
}

export function sendText(response, statusCode, value, contentType) {
    response.writeHead(statusCode, {
        "content-type": contentType,
        "cache-control": "no-store",
    });
    response.end(value);
}

function publicPathCandidates(pathname) {
    const decodedPathname = decodeURIComponent(pathname);
    if (decodedPathname === "/") {
        return ["/index.html"];
    }

    if (path.extname(decodedPathname)) {
        return [decodedPathname];
    }

    const normalizedPathname = decodedPathname.endsWith("/") ? decodedPathname.slice(0, -1) : decodedPathname;
    return [`${normalizedPathname}/index.html`, decodedPathname];
}

function isWithinPublicDir(publicDir, filePath) {
    const relativePath = path.relative(publicDir, filePath);
    return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function contentTypeForPath(filePath) {
    switch (path.extname(filePath).toLowerCase()) {
        case ".html":
            return "text/html; charset=utf-8";
        case ".js":
        case ".mjs":
            return "text/javascript; charset=utf-8";
        case ".css":
            return "text/css; charset=utf-8";
        case ".json":
            return "application/json; charset=utf-8";
        case ".svg":
            return "image/svg+xml";
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".ico":
            return "image/x-icon";
        default:
            return "application/octet-stream";
    }
}
