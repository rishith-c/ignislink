// TRIBE v2 brain-encoder client.
//
// TRIBE v2 (Meta, 2025; arXiv:2507.22229) predicts whole-brain fMRI BOLD
// response from multimodal stimuli. It is NOT a fear or threat classifier —
// the scalar this module produces is the RMS amplitude of the predicted
// neural-response vector for the incident summary, surfaced as one honest
// interpretability signal in the dispatcher console.
//
// The browser cannot run the model directly, so we proxy through one of two
// public HuggingFace Spaces. If both are unreachable (cold-start, sleeping
// Space, rate limit), the route handler falls back to a deterministic
// estimate built from the existing intel signals — and the badge clearly
// labels that mode "synthetic estimate" so the UI never lies about its
// source.

import type { FixtureIncident } from "@/lib/fixtures";

const SPACE_FETCH_TIMEOUT_MS = 12_000;
const HF_INFERENCE_URL =
  "https://api-inference.huggingface.co/models/facebook/tribev2";

/** Public TRIBE v2 Space candidates. Override via TRIBE_SPACE_URL env var. */
export const SPACE_CANDIDATES: readonly string[] = (() => {
  const override = process.env.TRIBE_SPACE_URL;
  const defaults = [
    "https://thesilenthowler029-tribe-v2-api.hf.space",
    "https://beta3-tribe-v2-neural-activity-predictor.hf.space",
  ];
  return override ? [override, ...defaults] : defaults;
})();

export type TribeMode = "space" | "synthetic";

export interface TribeCallResult {
  /** RMS amplitude in 0..1 (NaN when no Space responded). */
  amplitude: number;
  /** Raw RMS norm before clamping (null when no Space responded). */
  rawNorm: number | null;
  mode: TribeMode;
  /** Which Space URL answered, if any. */
  spaceId: string | null;
}

/** Lightweight fields used to compose a TRIBE stimulus. */
export interface TribeStimulusContext {
  populationThreat?: number;
  fuelFactor?: number;
  predicted24hAcres?: number;
  nearestCity?: { name: string; state: string; distanceKm: number } | null;
  lethalRisk?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
}

/**
 * Build a one-paragraph natural-language summary describing the incident.
 * Pure function so it can be reused from anywhere — the API route passes
 * just the incident, but a future caller could enrich with an IntelResponse.
 */
export function stimulusFromIncident(
  incident: FixtureIncident,
  ctx: TribeStimulusContext = {},
): string {
  const acres =
    ctx.predicted24hAcres ??
    incident.predictedSpread.find((p) => p.horizonMin === 1440)?.areaAcres ??
    0;
  const windKph = (incident.windSpeedMs * 3.6).toFixed(0);
  const risk = ctx.lethalRisk ? ` Lethal risk band: ${ctx.lethalRisk}.` : "";
  const city = ctx.nearestCity
    ? ` Nearest urban centre: ${ctx.nearestCity.name}, ${ctx.nearestCity.state}, ${ctx.nearestCity.distanceKm.toFixed(0)} km.`
    : "";
  const pop =
    ctx.populationThreat !== undefined
      ? ` Population-threat score ${ctx.populationThreat}/100.`
      : "";
  const fuel =
    ctx.fuelFactor !== undefined
      ? ` Fuel factor ${ctx.fuelFactor.toFixed(2)}.`
      : "";
  return [
    `Wildfire incident at ${incident.neighborhood}, ${incident.county}, ${incident.state}.`,
    ` Verification status: ${incident.verification}.`,
    ` Fire Radiative Power ${incident.fireRadiativePower.toFixed(0)} MW.`,
    ` Wind ${windKph} km/h from ${incident.windDirDeg}°.`,
    ` Projected 24h spread: ${acres.toLocaleString()} acres.`,
    risk,
    city,
    pop,
    fuel,
  ]
    .join("")
    .trim();
}

/**
 * Attempt to call a TRIBE v2 Space and return an amplitude. Never throws —
 * returns mode "synthetic" when every attempt fails so the route can
 * compute a deterministic estimate.
 */
export async function callTribeSpace(
  stimulus: string,
  opts: { timeoutMs?: number; hfToken?: string | null } = {},
): Promise<TribeCallResult> {
  const timeoutMs = opts.timeoutMs ?? SPACE_FETCH_TIMEOUT_MS;
  const hfToken = opts.hfToken ?? process.env.HF_TOKEN ?? null;

  for (const space of SPACE_CANDIDATES) {
    const raw = await tryCallOneSpace(space, stimulus, timeoutMs);
    if (raw === null) continue;
    const rawNorm = amplitudeFromResponse(raw);
    if (Number.isFinite(rawNorm)) {
      return {
        amplitude: clamp01(rawNorm),
        rawNorm,
        mode: "space",
        spaceId: space,
      };
    }
  }

  // HF Inference API fallback (only when token is present).
  if (hfToken) {
    const raw = await tryCallInferenceApi(stimulus, hfToken, timeoutMs);
    if (raw !== null) {
      const rawNorm = amplitudeFromResponse(raw);
      if (Number.isFinite(rawNorm)) {
        return {
          amplitude: clamp01(rawNorm),
          rawNorm,
          mode: "space",
          spaceId: HF_INFERENCE_URL,
        };
      }
    }
  }

  return { amplitude: NaN, rawNorm: null, mode: "synthetic", spaceId: null };
}

async function tryCallOneSpace(
  spaceUrl: string,
  stimulus: string,
  timeoutMs: number,
): Promise<unknown | null> {
  // Gradio REST contract first — best-documented, broadest compatibility.
  const gradio = await safePost(
    `${spaceUrl.replace(/\/$/, "")}/run/predict`,
    { data: [stimulus] },
    timeoutMs,
  );
  if (gradio !== null) return gradio;

  // Docker REST fallback — try common JSON shapes.
  const docker1 = await safePost(
    `${spaceUrl.replace(/\/$/, "")}/predict`,
    { text: stimulus },
    timeoutMs,
  );
  if (docker1 !== null) return docker1;

  const docker2 = await safePost(
    `${spaceUrl.replace(/\/$/, "")}/predict`,
    { input: stimulus },
    timeoutMs,
  );
  if (docker2 !== null) return docker2;

  return null;
}

async function tryCallInferenceApi(
  stimulus: string,
  hfToken: string,
  timeoutMs: number,
): Promise<unknown | null> {
  return safePost(
    HF_INFERENCE_URL,
    { inputs: stimulus },
    timeoutMs,
    { Authorization: `Bearer ${hfToken}` },
  );
}

async function safePost(
  url: string,
  body: unknown,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("application/json")) return null;
    try {
      return (await res.json()) as unknown;
    } catch {
      return null;
    }
  } catch (err) {
    console.warn(
      `[tribe] ${url} unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk an opaque Space response and compute the RMS norm of the first
 * numeric array we find. Handles {data:[...]}, {prediction:[...]},
 * {outputs:[...]}, raw arrays, and 2D arrays (flattened).
 *
 * Returns NaN when no numeric array can be extracted.
 */
export function amplitudeFromResponse(raw: unknown): number {
  const arr = findNumericArray(raw, 0);
  if (!arr || arr.length === 0) return NaN;
  let sumSq = 0;
  for (const v of arr) sumSq += v * v;
  return Math.sqrt(sumSq / arr.length);
}

function findNumericArray(node: unknown, depth: number): number[] | null {
  if (depth > 8) return null;
  if (Array.isArray(node)) {
    // Flat numeric array.
    if (node.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return node as number[];
    }
    // 2D numeric array — flatten.
    if (
      node.every(
        (row) =>
          Array.isArray(row) &&
          row.every((v) => typeof v === "number" && Number.isFinite(v)),
      )
    ) {
      return (node as number[][]).flat();
    }
    // Recurse into elements.
    for (const item of node) {
      const found = findNumericArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // Common keys first.
    for (const key of ["data", "prediction", "predictions", "outputs", "output", "result"]) {
      if (key in obj) {
        const found = findNumericArray(obj[key], depth + 1);
        if (found) return found;
      }
    }
    for (const value of Object.values(obj)) {
      const found = findNumericArray(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  // TRIBE v2 BOLD predictions are roughly z-scored, so RMS lives in ~0..3.
  // Map [0..2] → [0..1] with a soft clamp.
  const ref = 2;
  return Math.max(0, Math.min(1, n / ref));
}
