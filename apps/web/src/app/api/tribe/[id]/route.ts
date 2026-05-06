// GET /api/tribe/[id] — call Meta TRIBE v2 brain encoder for an incident.
//
// TRIBE v2 predicts whole-brain fMRI BOLD response from multimodal stimuli.
// We send the incident summary as text and surface the RMS amplitude of the
// returned vector as one interpretability signal. When every Space attempt
// fails, we fall back to a deterministic estimate computed from the existing
// intel signals — and the response is labelled mode="synthetic" so the UI
// can render that honestly.

import { NextResponse } from "next/server";
import { FIXTURE_INCIDENTS, type FixtureIncident } from "@/lib/fixtures";
import {
  callTribeSpace,
  stimulusFromIncident,
  type TribeMode,
} from "@/lib/tribe/client";

export const runtime = "nodejs";

interface TribeRouteResponse {
  incidentId: string;
  amplitude: number;
  rawNorm: number | null;
  mode: TribeMode;
  spaceId: string | null;
  stimulus: string;
  fetchedAt: string;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const incident = FIXTURE_INCIDENTS.find((i) => i.id === id);
  if (!incident) {
    return NextResponse.json({ error: "incident not found" }, { status: 404 });
  }

  const stimulus = stimulusFromIncident(incident);
  const result = await callTribeSpace(stimulus);

  const amplitude = Number.isFinite(result.amplitude)
    ? result.amplitude
    : syntheticAmplitude(incident);

  const body: TribeRouteResponse = {
    incidentId: incident.id,
    amplitude,
    rawNorm: result.rawNorm,
    mode: result.mode,
    spaceId: result.spaceId,
    stimulus,
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "max-age=60" },
  });
}

/**
 * Deterministic fallback when no TRIBE Space responds.
 * Combines intensity (FRP), population pressure (size proxy), fuel factor,
 * and projected 24h spread. Returns a stable scalar in 0..1.
 */
function syntheticAmplitude(incident: FixtureIncident): number {
  const intensity = Math.min(100, (incident.fireRadiativePower / 500) * 100);
  const acres24h =
    incident.predictedSpread.find((p) => p.horizonMin === 1440)?.areaAcres ?? 0;
  // Population proxy: larger projected fires near urban-coded neighborhoods
  // — kept simple to stay deterministic without re-fetching intel.
  const populationThreat = Math.min(100, Math.log10(acres24h + 1) * 25);
  const fuelFactor =
    /grass|sage|range|sequoia|chaparral/i.test(incident.neighborhood)
      ? 0.85
      : /forest|pine|wood|sierra|cascade/i.test(incident.neighborhood)
        ? 0.55
        : 0.7;
  // Risk floor from verification status (proxy for lethal-risk score / 100).
  const riskFloor =
    incident.verification === "EMERGING"
      ? 0.6
      : incident.verification === "CREWS_ACTIVE"
        ? 0.45
        : incident.verification === "UNREPORTED"
          ? 0.3
          : 0.15;

  const score =
    0.35 * (intensity / 100) +
    0.25 * (populationThreat / 100) +
    0.2 * fuelFactor +
    0.2 * riskFloor;

  return Math.max(0, Math.min(1, score));
}
