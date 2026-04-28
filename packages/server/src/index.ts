/**
 * @stfc-mod-sidecar/server
 *
 * HTTP server entry. Owns SSE event stream, REST control surface, mod ingest,
 * settings read/patch, and Majel bridge. UI consumes only HTTP — never IPC —
 * so the same UI runs in Electron, Overwolf, or a browser tab.
 *
 * Migration from packages/viewer/server.mjs lands in the next commit. This
 * file exists so the package is buildable as part of the groundwork scaffold.
 */

export const SERVER_VERSION = "0.0.0";

export interface ServerStartOptions {
  port?: number;
  host?: string;
}

export async function startServer(_options: ServerStartOptions = {}): Promise<void> {
  throw new Error(
    "Server migration pending. See docs/14-electron-overlay-architecture.md.",
  );
}
