// Mandatory contract test — PRD §4.5.
//
// This test guards the public/internal redaction boundary. Every field in
// IncidentInternalEvent that should NOT appear in IncidentPublicEvent is
// asserted to be absent. New internal-only fields require a corresponding
// addition to this test or the contract gate fails.

import { describe, expect, it } from "vitest";
import {
  IncidentInternalEventSchema,
  IncidentPublicEventSchema,
  toPublicEvent,
  type IncidentInternalEvent,
} from "../src/incident-events.js";
import type { VerificationStatus } from "../src/verification.js";

const baseInternal: IncidentInternalEvent = IncidentInternalEventSchema.parse({
  schema_version: 1,
  event: "incident.internal.updated",
  incident_id: "11111111-1111-1111-1111-111111111111",
  emitted_at: "2026-05-02T04:00:00.000Z",
  hotspot: { type: "Point", coordinates: [-120.5, 37.4] },
  verification_status: "EMERGING",
  firms_confidence: "high",
  predicted_horizons: [
    {
      horizon_min: 60,
      p25: { type: "MultiPolygon", coordinates: [] },
      p50: { type: "MultiPolygon", coordinates: [] },
      p75: { type: "MultiPolygon", coordinates: [] },
    },
    {
      horizon_min: 360,
      p25: { type: "MultiPolygon", coordinates: [] },
      p50: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [-120.6, 37.3],
              [-120.4, 37.3],
              [-120.4, 37.5],
              [-120.6, 37.5],
              [-120.6, 37.3],
            ],
          ],
        ],
      },
      p75: { type: "MultiPolygon", coordinates: [] },
    },
    {
      horizon_min: 1440,
      p25: { type: "MultiPolygon", coordinates: [] },
      p50: { type: "MultiPolygon", coordinates: [] },
      p75: { type: "MultiPolygon", coordinates: [] },
    },
  ],
  locality: {
    neighborhood: "Pinecrest",
    county: "Tuolumne",
    state_code: "CA",
  },
  station_candidates: [
    {
      station_id: "abc-123",
      name: "Twain Harte FPD",
      agency: "Tuolumne County",
      location: { type: "Point", coordinates: [-120.2, 38.0] },
      eta_seconds: 720,
      distance_meters: 11000,
    },
  ],
  partner_metadata: { internal_only: "do-not-leak" },
});

describe("toPublicEvent — redaction contract (PRD §4.5)", () => {
  it("emits a public event for EMERGING + 6h prediction", () => {
    const pub = toPublicEvent(baseInternal, "9q8yyy");
    expect(pub).not.toBeNull();
    expect(IncidentPublicEventSchema.parse(pub)).toBeDefined();
  });

  it("returns null for UNREPORTED (filtered from public stream)", () => {
    const pub = toPublicEvent(
      { ...baseInternal, verification_status: "UNREPORTED" satisfies VerificationStatus },
      "9q8yyy",
    );
    expect(pub).toBeNull();
  });

  it("returns null for KNOWN_PRESCRIBED", () => {
    const pub = toPublicEvent(
      { ...baseInternal, verification_status: "KNOWN_PRESCRIBED" satisfies VerificationStatus },
      "9q8yyy",
    );
    expect(pub).toBeNull();
  });

  it("returns null for LIKELY_INDUSTRIAL", () => {
    const pub = toPublicEvent(
      { ...baseInternal, verification_status: "LIKELY_INDUSTRIAL" satisfies VerificationStatus },
      "9q8yyy",
    );
    expect(pub).toBeNull();
  });

  it("drops exact hotspot, replacing with rounded geohash", () => {
    const pub = toPublicEvent(baseInternal, "9q8yyy");
    expect(pub).not.toBeNull();
    // exact hotspot must NOT appear on the public event
    expect(JSON.stringify(pub)).not.toContain(`"-120.5"`);
    expect(JSON.stringify(pub)).not.toContain("37.4");
    expect(pub!.hotspot_geohash6).toBe("9q8yyy");
  });

  it("drops FIRMS confidence score", () => {
    const pub = toPublicEvent(baseInternal, "9q8yyy");
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain("firms_confidence");
  });

  it("drops station candidates and dispatch payload entirely", () => {
    const pub = toPublicEvent(baseInternal, "9q8yyy");
    expect(pub).not.toBeNull();
    const json = JSON.stringify(pub);
    expect(json).not.toContain("station_id");
    expect(json).not.toContain("station_candidates");
    expect(json).not.toContain("Twain Harte"); // station name leaked → fail
    expect(json).not.toContain("eta_seconds");
  });

  it("drops partner metadata", () => {
    const pub = toPublicEvent(baseInternal, "9q8yyy");
    expect(JSON.stringify(pub)).not.toContain("partner_metadata");
    expect(JSON.stringify(pub)).not.toContain("do-not-leak");
  });

  it("drops neighborhood; preserves county + state", () => {
    const pub = toPublicEvent(baseInternal, "9q8yyy");
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain("Pinecrest");
    expect(pub!.locality.county).toBe("Tuolumne");
    expect(pub!.locality.state_code).toBe("CA");
  });

  it("preserves ONLY the t+6h 50% contour; drops 25/75 bands and 1h/24h", () => {
    const pub = toPublicEvent(baseInternal, "9q8yyy");
    expect(pub).not.toBeNull();
    // Public event has spread_t6h_p50 only — schema-level guarantee, but assert
    // the JSON shape to catch any ad-hoc field additions.
    const keys = Object.keys(pub!);
    expect(keys).not.toContain("predicted_horizons");
    expect(keys).not.toContain("p25");
    expect(keys).not.toContain("p75");
    expect(keys).not.toContain("spread_t1h_p50");
    expect(keys).not.toContain("spread_t24h_p50");
    expect(keys).toContain("spread_t6h_p50");
  });

  it("returns null when the 6h prediction is missing", () => {
    const pub = toPublicEvent(
      {
        ...baseInternal,
        predicted_horizons: baseInternal.predicted_horizons.filter((h) => h.horizon_min !== 360),
      },
      "9q8yyy",
    );
    expect(pub).toBeNull();
  });

  it("rejects invalid caller-provided geohash values", () => {
    expect(() => toPublicEvent(baseInternal, "not-valid")).toThrow();
  });
});
