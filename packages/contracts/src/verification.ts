// Verification taxonomy — PRD §3.2 (5 statuses).

import { z } from "zod";

export const VerificationStatusSchema = z.enum([
  "UNREPORTED",
  "EMERGING",
  "CREWS_ACTIVE",
  "KNOWN_PRESCRIBED",
  "LIKELY_INDUSTRIAL",
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

// Statuses that are visible on the Public Awareness Map (§4.2).
// `UNREPORTED` is intentionally hidden in v1 to avoid civilian alarm from
// satellite-only false positives. `KNOWN_PRESCRIBED` and `LIKELY_INDUSTRIAL`
// are also hidden — they're not active wildland fires.
export const PUBLIC_VISIBLE_STATUSES: readonly VerificationStatus[] = [
  "EMERGING",
  "CREWS_ACTIVE",
] as const;

export function isPublicVisibleStatus(s: VerificationStatus): boolean {
  return (PUBLIC_VISIBLE_STATUSES as readonly string[]).includes(s);
}

export const VerificationSourceSchema = z.object({
  kind: z.enum(["news", "social", "scanner", "registry", "manual"]),
  title: z.string(),
  snippet: z.string().nullable(),
  url: z.string().url().nullable(),
  retrieved_at: z.string().datetime({ offset: true }),
  // 0..1 score from the corroboration ranker.
  confidence: z.number().min(0).max(1),
});
export type VerificationSource = z.infer<typeof VerificationSourceSchema>;

export const VerificationResultSchema = z.object({
  schema_version: z.literal(1),
  detection_id: z.string().uuid(),
  status: VerificationStatusSchema,
  decided_at: z.string().datetime({ offset: true }),
  // Top-N corroborating sources used to reach the decision.
  sources: z.array(VerificationSourceSchema).max(10),
  // Human-readable rationale for audit; never includes raw PII.
  rationale: z.string().min(0).max(500),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
