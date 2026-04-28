#!/usr/bin/env node
import { startServer } from "./index.js";

await startServer({
  port: Number(process.env.STFC_SIDECAR_PORT ?? 43127),
  host: process.env.STFC_SIDECAR_HOST ?? "127.0.0.1",
});
