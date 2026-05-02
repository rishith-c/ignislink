// Public ↔ internal event split — PRD §4.5.
//
// HARD CONSTRAINT (committed to Codex 2026-05-02T04:40:23Z):
// the public stream is server-side-redacted. `incident.public.*` events MUST
// NOT carry station IDs, dispatch payloads, partner metadata, FIRMS confidence
// scores, exact lat/lon, neighborhood-level locality, or UNREPORTED-grade
// verification statuses. The redaction is enforced by `toPublicEvent()` below
// AND asserted by `__tests__/redaction.test.ts`.

import { z } from "zod";
import { PointSchema, MultiPolygonSchema } from "./geometry.js";
import {
  VerificationStatusSchema,
  PUBLIC_VISIBLE_STATUSES,
  type VerificationStatus,
} from "./verification.js";
import { StationCandidateSchema } from "./dispatch.js";
import { HorizonMinSchema } from "./predict-spread.js";

// ─────────────────── Internal event (full fidelity) ──────────────────────

export const IncidentInternalEventSchema = z
  .object({
    schema_version: z.literal(1),
    event: z.enum([
      "incident.internal.created",
      "incident.internal.updated",
      "incident.internal.resolved",
    ]),
    incident_id: z.string().uuid(),
    emitted_at: z.string().datetime({ offset: true }),
    hotspot: PointSchema,
    verification_status: VerificationStatusSchema,
    firms_confidence: z.enum(["low", "nominal", "high"]),
    predicted_horizons: z
      .array(
        z
          .object({
            horizon_min: HorizonMinSchema,
            p25: MultiPolygonSchema,
            p50: MultiPolygonSchema,
            p75: MultiPolygonSchema,
          })
          .strict(),
      )
      .max(3),
    locality: z
      .object({
        neighborhood: z.string().nullable(),
        county: z.string().nullable(),
        state_code: z.string().length(2).nullable(),
      })
      .strict(),
    station_candidates: z.array(StationCandidateSchema).max(5),
    partner_metadata: z.record(z.unknown()).default({}),
  })
  .strict();
export type IncidentInternalEvent = z.infer<typeof IncidentInternalEventSchema>;

// ─────────────────── Public event (redacted) ─────────────────────────────

// Allowed verification statuses for the public stream (§4.5).
export const PublicVerificationStatusSchema = z.enum(["EMERGING", "CREWS_ACTIVE"]);
export type PublicVerificationStatus = z.infer<typeof PublicVerificationStatusSchema>;

export const IncidentPublicEventSchema = z
  .object({
    schema_version: z.literal(1),
    event: z.enum([
      "incident.public.created",
      "incident.public.updated",
      "incident.public.resolved",
    ]),
    incident_id: z.string().uuid(),
    emitted_at: z.string().datetime({ offset: true }),
    // Hotspot rounded to a 500 m geohash precision (geohash length 6 ≈ 1.2 km;
    // length 7 ≈ 152 m. We use length 6 for ~ 500 m as compromise between privacy
    // and usefulness on the public map). The exact geohash encoding is in
    // packages/geospatial/src/geohash.ts.
    hotspot_geohash6: z.string().regex(/^[0-9bcdefghjkmnpqrstuvwxyz]{6}$/),
    // PUBLIC_VISIBLE_STATUSES only — UNREPORTED, KNOWN_PRESCRIBED,
    // LIKELY_INDUSTRIAL never appear here.
    verification_status: PublicVerificationStatusSchema,
    // ONLY the t+6h 50% contour. No 25/75 % bands. No 1 h / 24 h horizons.
    spread_t6h_p50: MultiPolygonSchema,
    // County-only locality. No neighborhood string.
    locality: z
      .object({
        county: z.string().nullable(),
        state_code: z.string().length(2).nullable(),
      })
      .strict(),
  })
  .strict();
export type IncidentPublicEvent = z.infer<typeof IncidentPublicEventSchema>;

// ─────────────────── Redaction (SERVER-SIDE) ─────────────────────────────

/**
 * Convert an internal event into the public-stream-safe redacted form.
 * Returns `null` if the incident's verification status isn't allowed on the
 * public stream — in that case the public emitter must drop the event entirely.
 *
 * This function is the *only* sanctioned way to derive a public event. The
 * contract test in __tests__/redaction.test.ts asserts that:
 *   - every field that exists on the internal event but not on the public
 *     event is dropped (no leakage);
 *   - status filtering matches PUBLIC_VISIBLE_STATUSES;
 *   - the t+6h 50% contour is preserved when present;
 *   - all other horizons & probability bands are dropped.
 */
export function toPublicEvent(
  internal: IncidentInternalEvent,
  hotspotGeohash6: string,
): IncidentPublicEvent | null {
  if (!isPublicAllowedStatus(internal.verification_status)) return null;

  const horizon6h = internal.predicted_horizons.find((h) => h.horizon_min === 360);
  if (!horizon6h) return null; // require a 6h prediction for public emission

  // Map the event-suffix from internal.* to public.*.
  const eventName = internal.event.replace("internal.", "public.") as IncidentPublicEvent["event"];

  return IncidentPublicEventSchema.parse({
    schema_version: 1,
    event: eventName,
    incident_id: internal.incident_id,
    emitted_at: internal.emitted_at,
    hotspot_geohash6: hotspotGeohash6,
    verification_status: internal.verification_status,
    spread_t6h_p50: horizon6h.p50,
    locality: {
      county: internal.locality.county,
      state_code: internal.locality.state_code,
    },
  });
}

function isPublicAllowedStatus(s: VerificationStatus): s is PublicVerificationStatus {
  return (PUBLIC_VISIBLE_STATUSES as readonly string[]).includes(s);
}
