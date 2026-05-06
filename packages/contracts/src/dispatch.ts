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

// Resource kind taxonomy. Aerial / ground / hand resources differ in ETA model
// (helicopters use slant range / cruise speed, not driving directions),
// staging area shape, and which incidents they're effective against.
export const ResourceKindSchema = z.enum([
  "engine", // Type-1 / Type-3 fire engine, water + crew
  "helicopter", // Type-1 / Type-2 / Type-3 rotor — water drops + transport
  "fixed-wing", // SEAT / large air tanker — retardant drops
  "dozer", // bulldozer for line cutting
  "hand-crew", // 20-person hand crew
]);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

// Capabilities a resource can provide. Used by the dispatch ranker to match
// the right kit to incident size + fuel type + access.
export const ResourceCapabilitySchema = z.enum([
  "structure-protection",
  "wildland-attack",
  "aerial-water-drop",
  "aerial-retardant-drop",
  "line-cutting",
  "command-and-control",
  "medical",
]);
export type ResourceCapability = z.infer<typeof ResourceCapabilitySchema>;

export const ResourceCandidateSchema = z
  .object({
    resource_id: z.string().min(1).describe("Stable opaque id"),
    kind: ResourceKindSchema,
    name: z.string(),
    agency: z.string(),
    home_base: PointSchema,
    eta_seconds: z.number().int().nonnegative(),
    /**
     * Slant or driving distance, depending on `kind`. Aerial resources use
     * great-circle distance; ground resources use driving distance.
     */
    distance_meters: z.number().int().nonnegative(),
    /** Cruise speed used to compute the ETA (m/s). Helps the dispatcher
     *  reason about whether to send aerial first. */
    cruise_speed_ms: z.number().nonnegative().nullable(),
    capabilities: z.array(ResourceCapabilitySchema).max(8),
    /** True if the resource is currently in service (not on another call). */
    available: z.boolean(),
  })
  .strict();
export type ResourceCandidate = z.infer<typeof ResourceCandidateSchema>;

// Capability scores used by the ranker — higher = better match for the
// incident's profile.
const CAPABILITY_WEIGHT: Record<ResourceCapability, number> = {
  "wildland-attack": 1.0,
  "aerial-water-drop": 0.9,
  "aerial-retardant-drop": 0.85,
  "line-cutting": 0.7,
  "structure-protection": 0.6,
  "command-and-control": 0.4,
  medical: 0.3,
};

interface RankInput {
  /** Resources to score, must be `available: true` to qualify. */
  candidates: readonly ResourceCandidate[];
  /** Lethal-risk band — drives capability weighting. CRITICAL fires need
   *  more aerial / line-cutting. */
  risk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  /** Predicted t+6h area, acres. Larger fires need aerial. */
  predicted6hAcres: number;
}

/**
 * Rank multi-modal resources for dispatch.
 *
 * Score = (capability_match × risk_multiplier) − ETA_penalty
 *   where ETA_penalty = eta_seconds / 600  (each 10 min costs 1 point)
 *
 * The ranker prioritises the FIRST aerial resource for any HIGH/CRITICAL
 * incident or any incident whose 6h projection exceeds 50 acres — by
 * convention the dispatcher sends aerial as soon as it's available because
 * the ground resource arrival window is too long for fast-spreading fires.
 *
 * Returns the resources sorted descending by score. Unavailable resources
 * are filtered out entirely.
 */
export function rankResources({
  candidates,
  risk,
  predicted6hAcres,
}: RankInput): ResourceCandidate[] {
  const aerialBoost =
    risk === "CRITICAL" || risk === "HIGH" || predicted6hAcres > 50 ? 0.6 : 0.0;

  const scored = candidates
    .filter((r) => r.available)
    .map((r) => {
      const capScore =
        r.capabilities.length === 0
          ? 0
          : r.capabilities.reduce((s, c) => s + CAPABILITY_WEIGHT[c], 0) / r.capabilities.length;
      const isAerial = r.kind === "helicopter" || r.kind === "fixed-wing";
      const aerial = isAerial ? aerialBoost : 0;
      const etaPenalty = r.eta_seconds / 600;
      const score = capScore + aerial - etaPenalty;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.r);
}

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
// HMAC-SHA256 over the JSON body in the `X-IgnisLink-Signature` header.
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
