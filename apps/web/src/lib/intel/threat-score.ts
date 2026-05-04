// Multi-dimensional threat scoring (0–100 each).
//
// These are heuristic scores designed to be defensible and explainable, not
// the output of a trained model. The U-Net+ConvLSTM model from Stage 3 will
// eventually replace the spread-projection input; until then we use the
// fixture's predictedSpread directly.

import { US_CITIES, type City } from "./cities";

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface PopulationExposure {
  /** People within 5 km radius. */
  pop5km: number;
  /** People within 25 km radius. */
  pop25km: number;
  /** Closest population center (≥10 k). */
  nearestCity: { name: string; state: string; distanceKm: number; pop: number } | null;
  /** 0-100 score. */
  score: number;
}

export function scorePopulation(lat: number, lon: number): PopulationExposure {
  let pop5 = 0;
  let pop25 = 0;
  let nearest: { city: City; distance: number } | null = null;
  for (const c of US_CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d <= 5) pop5 += c.pop;
    if (d <= 25) pop25 += c.pop;
    if (c.pop >= 10000 && (!nearest || d < nearest.distance)) {
      nearest = { city: c, distance: d };
    }
  }
  // Population-threat score: log scale, blended near + medium ring.
  // log10(1) = 0, log10(1e5) = 5, log10(1e6) = 6 → normalize to 0-100.
  const ln5 = Math.log10(pop5 + 1) / 6.5;
  const ln25 = Math.log10(pop25 + 1) / 7;
  const score = Math.round(100 * Math.min(1, 0.65 * ln5 + 0.35 * ln25));
  return {
    pop5km: pop5,
    pop25km: pop25,
    nearestCity: nearest
      ? {
          name: nearest.city.name,
          state: nearest.city.state,
          distanceKm: nearest.distance,
          pop: nearest.city.pop,
        }
      : null,
    score,
  };
}

export interface ThreatScore {
  /** Overall fire-intensity score 0-100 (FRP + wind × fuel + projected size). */
  fireIntensity: number;
  /** Population exposure score 0-100. */
  populationThreat: number;
  /** Containment score 0-100 (higher = more contained). */
  containment: number;
  /** Probability this is a controlled burn (registered prescribed) 0-100. */
  controlledLikelihood: number;
  /** Lethal-wildfire risk 0-100 (the headline). */
  lethalRisk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  lethalRiskScore: number;
  /** Plain-English rationale for the lethal-risk band, for the UI. */
  rationale: string[];
}

export function scoreThreat(opts: {
  lat: number;
  lon: number;
  fireRadiativePower: number;
  windSpeedMs: number;
  fuelFactor: number; // 0..1; grass=1, mixed=0.7, dense forest=0.4
  predicted24hAcres: number;
  verificationStatus:
    | "EMERGING"
    | "CREWS_ACTIVE"
    | "UNREPORTED"
    | "KNOWN_PRESCRIBED"
    | "LIKELY_INDUSTRIAL";
  daysSinceRain?: number;
}): { population: PopulationExposure; score: ThreatScore } {
  const population = scorePopulation(opts.lat, opts.lon);

  // ── Fire intensity ──
  // FRP up to ~500 MW maps to 0-1 (anything bigger is very rare).
  const frpScore = Math.min(1, opts.fireRadiativePower / 500);
  // Wind × fuel as proxy for spread potential.
  const windFuelScore = Math.min(1, (opts.windSpeedMs * opts.fuelFactor) / 10);
  // Projected 24 h area: log scale, 0-2000 acres typical.
  const sizeScore = Math.min(1, Math.log10(opts.predicted24hAcres + 1) / 4);
  const fireIntensity = Math.round(
    100 * (0.4 * frpScore + 0.3 * windFuelScore + 0.3 * sizeScore),
  );

  // ── Containment ──
  // Heuristic from verification status. Real implementation would consume
  // the Cal Fire feed's PercentContained when available.
  const containmentByStatus: Record<typeof opts.verificationStatus, number> = {
    KNOWN_PRESCRIBED: 95,
    LIKELY_INDUSTRIAL: 90,
    CREWS_ACTIVE: 55,
    EMERGING: 12,
    UNREPORTED: 5,
  };
  const containment = containmentByStatus[opts.verificationStatus];

  // ── Controlled-burn likelihood ──
  const controlledLikelihood =
    opts.verificationStatus === "KNOWN_PRESCRIBED"
      ? 95
      : opts.verificationStatus === "LIKELY_INDUSTRIAL"
        ? 85
        : opts.verificationStatus === "CREWS_ACTIVE"
          ? 25
          : 5;

  // ── Lethal-wildfire risk ──
  // Combines fire intensity, population threat, low containment, dryness.
  const dryness = Math.min(1, (opts.daysSinceRain ?? 14) / 30);
  const lethalRiskScore = Math.round(
    100 *
      Math.min(
        1,
        0.35 * (fireIntensity / 100) +
          0.3 * (population.score / 100) +
          0.2 * (1 - containment / 100) +
          0.15 * dryness,
      ),
  );

  let lethalRisk: ThreatScore["lethalRisk"] = "LOW";
  if (lethalRiskScore >= 75) lethalRisk = "CRITICAL";
  else if (lethalRiskScore >= 50) lethalRisk = "HIGH";
  else if (lethalRiskScore >= 25) lethalRisk = "MODERATE";

  // ── Rationale (1-3 sentences) ──
  const rationale: string[] = [];
  if (controlledLikelihood >= 80) {
    rationale.push(
      `${controlledLikelihood}% likely controlled — ${
        opts.verificationStatus === "KNOWN_PRESCRIBED"
          ? "registered prescribed burn"
          : "registered industrial flare zone"
      }.`,
    );
  } else {
    if (fireIntensity >= 70) {
      rationale.push(
        `Fire intensity ${fireIntensity}/100: FRP ${opts.fireRadiativePower.toFixed(0)} MW, wind ${opts.windSpeedMs.toFixed(1)} m/s, projected ${opts.predicted24hAcres.toLocaleString()} acres @ 24 h.`,
      );
    } else if (fireIntensity >= 40) {
      rationale.push(`Moderate fire intensity (${fireIntensity}/100).`);
    }
    if (population.score >= 60 && population.nearestCity) {
      rationale.push(
        `${population.pop25km.toLocaleString()} residents within 25 km; closest urban center ${population.nearestCity.name}, ${population.nearestCity.state} (${population.nearestCity.distanceKm.toFixed(0)} km).`,
      );
    }
    if (containment <= 20) {
      rationale.push(`Containment ${containment}% — perimeter not yet established.`);
    }
    if (dryness >= 0.7) {
      rationale.push(
        `${opts.daysSinceRain ?? 14}+ days since measurable precipitation — fuel-moisture-of-extinction risk.`,
      );
    }
  }
  if (rationale.length === 0) rationale.push("No elevated risk factors identified.");

  return {
    population,
    score: {
      fireIntensity,
      populationThreat: population.score,
      containment,
      controlledLikelihood,
      lethalRisk,
      lethalRiskScore,
      rationale,
    },
  };
}
