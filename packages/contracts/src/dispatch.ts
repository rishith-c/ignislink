// Dispatch payload — PRD §3 / F6 + §4.1 (detail sheet) + §6 (Codex routing).

import { z } from "zod";
import { PointSchema, MultiPolygonSchema } from "./geometry.js";
import { VerificationStatusSchema } from "./verification.js";
import { HorizonMinSchema } from "./predict-spread.js";

export const StationCandidateSchema = z
  .object({
    station_id: z.string().min(1).describe("ArcGIS Fire Stations REST objectid"),
    name: z.string(),
    agency: z.string(),
    location: PointSchema,
    eta_seconds: z.number().int().nonnegative().describe("Mapbox Directions ETA, driving"),
    distance_meters: z.number().int().nonnegative(),
  })
  .strict();
export type StationCandidate = z.infer<typeof StationCandidateSchema>;

export const SuggestedSpreadHorizonSchema = z
  .object({
    horizon_min: HorizonMinSchema,
    // We attach only the 50% probability ring — the dispatcher view shows that
    // by default, with the 25/75% bands available on toggle.
    contour_p50: MultiPolygonSchema,
  })
  .strict();
export type SuggestedSpreadHorizon = z.infer<typeof SuggestedSpreadHorizonSchema>;

export const DispatchPayloadSchema = z
  .object({
    schema_version: z.literal(1),
    dispatch_id: z.string().uuid(),
    incident_id: z.string().uuid(),
    detection_id: z.string().uuid(),
    hotspot: PointSchema,
    verification_status: VerificationStatusSchema,
    firms_confidence: z.enum(["low", "nominal", "high"]),
    predicted_spread: z.array(SuggestedSpreadHorizonSchema).max(3),
    staging_area: PointSchema.describe("Suggested upwind staging point, ~2 km offset"),
    station_candidates: z.array(StationCandidateSchema).max(5),
    // Auditing fields — every dispatch is logged with these.
    dispatched_by_user_id: z.string().min(1),
    dispatched_at: z.string().datetime({ offset: true }),
    model_version: z.string().min(1),
    context_source: z.enum(["hrrr", "open-meteo"]),
  })
  .strict();
export type DispatchPayload = z.infer<typeof DispatchPayloadSchema>;

// Outbound webhook envelope — what RapidSOS / municipal CAD partners receive.
// HMAC-SHA256 over the JSON body in the `X-SentryMax-Signature` header.
export const DispatchWebhookEnvelopeSchema = z
  .object({
    schema_version: z.literal(1),
    event: z.literal("dispatch.created"),
    // Idempotency key (PRD §2.4 P4 partner contract).
    idempotency_key: z.string().min(1),
    emitted_at: z.string().datetime({ offset: true }),
    payload: DispatchPayloadSchema,
  })
  .strict();
export type DispatchWebhookEnvelope = z.infer<typeof DispatchWebhookEnvelopeSchema>;
