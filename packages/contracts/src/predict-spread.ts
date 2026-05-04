// POST /predict/spread — fire-spread ML prediction contract.
// PRD §5.5 (serving) + HANDOFF 2026-05-02T04:40:23Z (committed shape).
//
// Owners: claude (model side) + codex (route side). Lock-required edits.

import { z } from "zod";
import { PointSchema, MultiPolygonSchema } from "./geometry.js";

export const SCHEMA_VERSION = 1 as const;

// One of the three supported horizons (in minutes). Held as a literal union so
// downstream tooling (zod-to-openapi → pydantic) emits a tight enum.
export const HorizonMinSchema = z.union([z.literal(60), z.literal(360), z.literal(1440)]);
export type HorizonMin = z.infer<typeof HorizonMinSchema>;

export const WindSummarySchema = z.object({
  u_ms: z.number().describe("East-component wind velocity, m/s"),
  v_ms: z.number().describe("North-component wind velocity, m/s"),
  gust_ms: z.number().min(0).describe("10-min gust max, m/s"),
  sample_at: z.string().datetime({ offset: true }).describe("HRRR cycle timestamp used"),
});
export type WindSummary = z.infer<typeof WindSummarySchema>;

export const PredictSpreadRequestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  detection_id: z.string().uuid(),
  hotspot: PointSchema,
  context_raster_key: z
    .string()
    .min(1)
    .describe("S3 key of the pre-bundled FireContext raster (FIRMS + HRRR + LANDFIRE + SRTM)"),
  wind_summary: WindSummarySchema,
  horizons_min: z
    .array(HorizonMinSchema)
    .min(1)
    .max(3)
    .default([60, 360, 1440])
    .describe("Default: 1 h / 6 h / 24 h"),
});
export type PredictSpreadRequest = z.infer<typeof PredictSpreadRequestSchema>;

export const HorizonResultSchema = z.object({
  horizon_min: HorizonMinSchema,
  contours: z.object({
    p25: MultiPolygonSchema,
    p50: MultiPolygonSchema,
    p75: MultiPolygonSchema,
  }),
  raster_key: z.string().min(1).describe("S3 key of the GeoTIFF (signed-URL on demand)"),
  // Per-horizon reliability tag — open ADR (Appendix A #2). Frontend uses it
  // to render the 24 h overlay with reduced opacity if "low".
  reliability: z.enum(["low", "medium", "high"]).optional(),
});
export type HorizonResult = z.infer<typeof HorizonResultSchema>;

export const PredictSpreadResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  model_version: z
    .string()
    .min(1)
    .describe("Matches MLflow registry tag, e.g., 'fire-spread-v0.3.1'"),
  generated_at: z.string().datetime({ offset: true }),
  horizons: z.array(HorizonResultSchema).min(1),
  inference_ms: z.number().int().nonnegative(),
  cache_hit: z.boolean(),
  input_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "SHA-256 hex")
    .describe("SHA256(detection_id|model_version|wind_summary.sample_at|context_raster_key)"),
  // Failure-mode advisory: if HRRR was unavailable and Open-Meteo was used, the
  // server tags the response so the console can show a "context fallback" badge.
  context_source: z.enum(["hrrr", "open-meteo"]).default("hrrr"),
});
export type PredictSpreadResponse = z.infer<typeof PredictSpreadResponseSchema>;

// Cache key derivation — kept in the contract so claude (model side) and codex
// (route side) compute it identically. Intentionally simple string concat with
// a fixed delimiter that none of the inputs can contain.
const CACHE_KEY_DELIMITER = "|";

export function deriveInputHashInputs(req: PredictSpreadRequest, modelVersion: string): string[] {
  return [req.detection_id, modelVersion, req.wind_summary.sample_at, req.context_raster_key];
}

export function deriveInputHashCanonical(req: PredictSpreadRequest, modelVersion: string): string {
  return deriveInputHashInputs(req, modelVersion).join(CACHE_KEY_DELIMITER);
}
