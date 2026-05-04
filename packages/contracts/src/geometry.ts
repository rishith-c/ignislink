// Minimal GeoJSON types as zod schemas. We don't need the full GeoJSON spec —
// only the shapes we actually emit / consume. Position is `[lon, lat]` per RFC 7946.

import { z } from "zod";

export const PositionSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe("[longitude, latitude] per RFC 7946 §3.1.1");

export const PointSchema = z.object({
  type: z.literal("Point"),
  coordinates: PositionSchema,
});

export const LineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(PositionSchema).min(2),
});

export const PolygonRingSchema = z.array(PositionSchema).min(4);
// (Note: a valid linear ring has ≥4 positions and the first === last; we don't
// enforce closure in the schema — Codex's worker normalizes before persisting.)

export const PolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(PolygonRingSchema).min(1),
});

export const MultiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(PolygonRingSchema).min(1)).min(0),
});

export const FeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: z.union([PointSchema, LineStringSchema, PolygonSchema, MultiPolygonSchema]),
      properties: z.record(z.unknown()).nullable(),
    }),
  ),
});

export type Position = z.infer<typeof PositionSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Polygon = z.infer<typeof PolygonSchema>;
export type MultiPolygon = z.infer<typeof MultiPolygonSchema>;
export type FeatureCollection = z.infer<typeof FeatureCollectionSchema>;
