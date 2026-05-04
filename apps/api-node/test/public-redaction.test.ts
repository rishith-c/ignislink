import { describe, expect, it } from "vitest";

import { redactIncidentForPublicStream } from "../src/lib/redaction.js";
import type { IncidentInternalEvent } from "@ignislink/contracts/incident-events";

const polygon = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [-122.1, 38.1],
        [-122.0, 38.1],
        [-122.0, 38.2],
        [-122.1, 38.1],
      ],
    ],
  ],
} as const;

const internal: IncidentInternalEvent = {
  schema_version: 1,
  event: "incident.internal.updated",
  incident_id: "b9c7e8d3-75b3-4d24-8b2e-0d212ec6c828",
  emitted_at: "2026-05-02T16:00:00.000Z",
  hotspot: { type: "Point", coordinates: [-122.05, 38.15] },
  verification_status: "EMERGING",
  firms_confidence: "nominal",
  predicted_horizons: [{ horizon_min: 360, p25: polygon, p50: polygon, p75: polygon }],
  locality: { neighborhood: "Hidden Ridge", county: "Napa", state_code: "CA" },
  station_candidates: [
    {
      station_id: "st-1",
      name: "Napa County Station 1",
      agency: "Napa County Fire",
      location: { type: "Point", coordinates: [-122.03, 38.2] },
      eta_seconds: 420,
      distance_meters: 5200,
    },
  ],
  partner_metadata: { cad: "secret" },
};

describe("public alert redaction", () => {
  it("removes station, partner, and exact hotspot data", () => {
    const publicEvent = redactIncidentForPublicStream(internal, "9qc0yq");

    expect(publicEvent).not.toBeNull();
    const serialized = JSON.stringify(publicEvent);
    expect(serialized).not.toContain("Napa County Station 1");
    expect(serialized).not.toContain("Hidden Ridge");
    expect(serialized).not.toContain("firms_confidence");
    expect(publicEvent?.hotspot_geohash6).toBe("9qc0yq");
  });
});
