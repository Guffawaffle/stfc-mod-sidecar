import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildSidecarFleetRuntimeTelemetryEvents, type FleetTelemetryBuildContext } from "./fleet-telemetry.js";

interface FleetFixture {
  envelope: {
    batchId: string;
    producedAt: string;
    sessionId: string;
    source: string;
    modVersion: string;
    payload: Parameters<typeof buildSidecarFleetRuntimeTelemetryEvents>[0][number]["payload"];
  };
  projectorContext: Omit<FleetTelemetryBuildContext, "nextSequence"> & { initialSequence: number };
  expectedTelemetryEvents: unknown[];
}

describe("Battle Bridge golden Fleet fixture", () => {
  it("freezes the complete production Fleet runtime projection", () => {
    const fixture = readFixture();
    let sequence = fixture.projectorContext.initialSequence;
    const events = buildSidecarFleetRuntimeTelemetryEvents(
      [{
        batchId: fixture.envelope.batchId,
        producedAt: fixture.envelope.producedAt,
        sessionId: fixture.envelope.sessionId,
        source: fixture.envelope.source,
        modVersion: fixture.envelope.modVersion,
        payload: fixture.envelope.payload,
      }],
      { ...fixture.projectorContext, nextSequence: () => ++sequence },
    );

    expect(events).toEqual(fixture.expectedTelemetryEvents);
  });
});

function readFixture(): FleetFixture {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(current, "../../../../examples/battle-bridge-golden-v1/fleet-runtime.json");
  return JSON.parse(readFileSync(file, "utf8")) as FleetFixture;
}
