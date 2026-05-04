// FIRMS detection — a single satellite thermal-anomaly hit.
// PRD §0 (glossary), §3 / F1 (ingest + dedup), §4.1 (console queue).

import { z } from "zod";
import { PointSchema } from "./geometry.js";

export const FirmsConfidenceSchema = z.enum(["low", "nominal", "high"]);
export type FirmsConfidence = z.infer<typeof FirmsConfidenceSchema>;

export const FirmsSensorSchema = z.enum([
  "viirs_snpp",
  "viirs_noaa20",
  "viirs_noaa21",
  "modis_aqua",
  "modis_terra",
]);
export type FirmsSensor = z.infer<typeof FirmsSensorSchema>;

export const DetectionSchema = z.object({
  schema_version: z.literal(1),
  detection_id: z.string().uuid().describe("UUID v4 minted at ingest time"),
  hotspot: PointSchema,
  observed_at: z
    .string()
    .datetime({ offset: true })
    .describe("Satellite acquisition time, ISO 8601, UTC"),
  ingested_at: z.string().datetime({ offset: true }).describe("Server receipt time"),
  sensor: FirmsSensorSchema,
  confidence: FirmsConfidenceSchema,
  bright_ti4_kelvin: z
    .number()
    .min(200)
    .max(800)
    .nullable()
    .describe("VIIRS I-4 brightness temperature; null for MODIS"),
  fire_radiative_power_mw: z
    .number()
    .min(0)
    .max(20000)
    .nullable()
    .describe("Fire Radiative Power in MW"),
  // Reverse-geocode results — best-effort, may be null for offshore / remote pixels.
  locality: z
    .object({
      neighborhood: z.string().nullable(),
      county: z.string().nullable(),
      state_code: z.string().length(2).nullable(),
      country_code: z.string().length(2),
    })
    .nullable(),
  // Provenance: which FIRMS feed (URT vs standard) and the source URL hash.
  provenance: z.object({
    feed: z.enum(["urt", "standard", "archive"]),
    source_url_hash: z.string().min(8),
    poll_batch_id: z.string().uuid(),
  }),
});

export type Detection = z.infer<typeof DetectionSchema>;

// Incident clustering rule (Appendix A item 1 — pending ADR; this is the proposed default).
export const ClusterRuleSchema = z.object({
  schema_version: z.literal(1),
  window_hours: z.number().int().positive().max(72).default(24),
  max_distance_meters: z.number().int().positive().max(10000).default(2000),
  honor_firebreaks: z.boolean().default(true),
});

export type ClusterRule = z.infer<typeof ClusterRuleSchema>;
