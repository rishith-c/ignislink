// Contract shape test for /predict/spread.

import { describe, expect, it } from "vitest";
import {
  PredictSpreadRequestSchema,
  PredictSpreadResponseSchema,
  deriveInputHashCanonical,
  SCHEMA_VERSION,
} from "../src/predict-spread.js";

describe("PredictSpreadRequest", () => {
  it("accepts a minimal valid request", () => {
    const ok = PredictSpreadRequestSchema.parse({
      schema_version: SCHEMA_VERSION,
      detection_id: "11111111-1111-1111-1111-111111111111",
      hotspot: { type: "Point", coordinates: [-120.5, 37.4] },
      context_raster_key: "ml/context/abc/2026-05-02T04:00:00Z.tif",
      wind_summary: {
        u_ms: 3.2,
        v_ms: -1.5,
        gust_ms: 7.0,
        sample_at: "2026-05-02T04:00:00.000Z",
      },
      horizons_min: [60, 360, 1440],
    });
    expect(ok.detection_id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects horizons not in {60, 360, 1440}", () => {
    expect(() =>
      PredictSpreadRequestSchema.parse({
        schema_version: SCHEMA_VERSION,
        detection_id: "11111111-1111-1111-1111-111111111111",
        hotspot: { type: "Point", coordinates: [-120.5, 37.4] },
        context_raster_key: "ml/context/abc/2026-05-02T04:00:00Z.tif",
        wind_summary: {
          u_ms: 0,
          v_ms: 0,
          gust_ms: 0,
          sample_at: "2026-05-02T04:00:00.000Z",
        },
        horizons_min: [120],
      }),
    ).toThrow();
  });

  it("rejects coordinates outside [-180, 180] / [-90, 90]", () => {
    expect(() =>
      PredictSpreadRequestSchema.parse({
        schema_version: SCHEMA_VERSION,
        detection_id: "11111111-1111-1111-1111-111111111111",
        hotspot: { type: "Point", coordinates: [-200, 37.4] },
        context_raster_key: "ml/context/abc/2026-05-02T04:00:00Z.tif",
        wind_summary: {
          u_ms: 0,
          v_ms: 0,
          gust_ms: 0,
          sample_at: "2026-05-02T04:00:00.000Z",
        },
        horizons_min: [60],
      }),
    ).toThrow();
  });
});

describe("deriveInputHashCanonical", () => {
  it("composes the four cache-key inputs in the documented order", () => {
    const req = PredictSpreadRequestSchema.parse({
      schema_version: SCHEMA_VERSION,
      detection_id: "aaaa1111-2222-3333-4444-555555555555",
      hotspot: { type: "Point", coordinates: [-120.5, 37.4] },
      context_raster_key: "ml/context/abc/2026-05-02T04:00:00Z.tif",
      wind_summary: {
        u_ms: 3.2,
        v_ms: -1.5,
        gust_ms: 7.0,
        sample_at: "2026-05-02T04:00:00.000Z",
      },
      horizons_min: [60, 360, 1440],
    });
    const canonical = deriveInputHashCanonical(req, "fire-spread-v0.3.1");
    expect(canonical).toBe(
      [
        "aaaa1111-2222-3333-4444-555555555555",
        "fire-spread-v0.3.1",
        "2026-05-02T04:00:00.000Z",
        "ml/context/abc/2026-05-02T04:00:00Z.tif",
      ].join("|"),
    );
  });
});

describe("PredictSpreadResponse", () => {
  it("requires a SHA-256 hex input_hash", () => {
    expect(() =>
      PredictSpreadResponseSchema.parse({
        schema_version: SCHEMA_VERSION,
        model_version: "fire-spread-v0.3.1",
        generated_at: "2026-05-02T04:00:00.000Z",
        horizons: [
          {
            horizon_min: 60,
            contours: {
              p25: { type: "MultiPolygon", coordinates: [] },
              p50: { type: "MultiPolygon", coordinates: [] },
              p75: { type: "MultiPolygon", coordinates: [] },
            },
            raster_key: "ml/predictions/abc/v0.3.1/60.tif",
          },
        ],
        inference_ms: 412,
        cache_hit: false,
        input_hash: "not-a-hash",
        context_source: "hrrr",
      }),
    ).toThrow();
  });
});
