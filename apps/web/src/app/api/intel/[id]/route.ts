// GET /api/intel/[id] — pull live intel for an incident.
//
// Cross-checks NASA FIRMS (server-side using FIRMS_API_KEY) and the public
// Cal Fire incidents feed, merges that with fixture-derived news / scanner /
// social signals, computes population threat from the bundled US-cities
// table, scores the fire across 5 dimensions, and returns a single payload
// the IntelPanel renders.

import { NextResponse } from "next/server";
import { FIXTURE_INCIDENTS } from "@/lib/fixtures";
import { crossCheckFirms } from "@/lib/intel/firms";
import { crossCheckCalFire } from "@/lib/intel/calfire";
import { scoreThreat } from "@/lib/intel/threat-score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── crew-on-scene guess (would be a Broadcastify/scanner pull in v1) ──
function guessCrewOnScene(
  status: string,
  sources: { kind: string; snippet: string }[],
): { onScene: boolean; source: string | null; rationale: string } {
  const scanner = sources.find((s) => s.kind === "scanner");
  if (status === "CREWS_ACTIVE") {
    return {
      onScene: true,
      source: "verification feed (CREWS_ACTIVE)",
      rationale: "Verification badge marks this incident as crews-on-scene.",
    };
  }
  if (scanner && /respond|on scene|engaged/i.test(scanner.snippet)) {
    return {
      onScene: true,
      source: "scanner traffic",
      rationale: "Scanner traffic indicates units responding code-3.",
    };
  }
  return {
    onScene: false,
    source: null,
    rationale: "No corroborating crew-on-scene signal in the last 60 min.",
  };
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

  // Run external cross-checks in parallel — neither blocks the rest.
  const [firms, calfire] = await Promise.all([
    crossCheckFirms({ lat: incident.lat, lon: incident.lon }),
    crossCheckCalFire({ lat: incident.lat, lon: incident.lon, state: incident.state }),
  ]);

  const predicted24hAcres =
    incident.predictedSpread.find((p) => p.horizonMin === 1440)?.areaAcres ?? 0;

  // Fuel-factor heuristic: pick from incident neighborhood. Real Stage 2 uses
  // LANDFIRE FBFM40 sampled at the hotspot location.
  const fuelFactor =
    /grass|sage|range|sequoia|chaparral/i.test(incident.neighborhood)
      ? 0.85
      : /forest|pine|wood|sierra|cascade/i.test(incident.neighborhood)
        ? 0.55
        : 0.7;

  const threat = scoreThreat({
    lat: incident.lat,
    lon: incident.lon,
    fireRadiativePower: incident.fireRadiativePower,
    windSpeedMs: incident.windSpeedMs,
    fuelFactor,
    predicted24hAcres,
    verificationStatus: incident.verification,
    daysSinceRain: 18, // placeholder — Stage 2 will sample HRRR antecedent precip
  });

  const crew = guessCrewOnScene(
    incident.verification,
    incident.verificationSources.map((s) => ({ kind: s.kind, snippet: s.snippet })),
  );

  return NextResponse.json({
    incidentId: incident.id,
    fetchedAt: new Date().toISOString(),
    sources: incident.verificationSources,
    firms: {
      ok: firms.ok,
      matched: firms.matched,
      closestKm: firms.closestKm,
      hits: firms.hits.slice(0, 5),
      source: firms.source,
      error: firms.error,
    },
    calfire: {
      ok: calfire.ok,
      match: calfire.match,
      matchDistanceKm: calfire.matchDistanceKm,
      error: calfire.error,
    },
    crew,
    threat: threat.score,
    population: threat.population,
    fuelFactor,
  });
}
