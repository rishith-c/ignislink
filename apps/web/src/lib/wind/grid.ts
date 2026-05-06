// Spatial wind-grid loader for the SENTRY 3D scene.
//
// Source: Open-Meteo's free Forecast API — no key, no rate-limit auth.
//   https://api.open-meteo.com/v1/forecast?latitude=...&longitude=...
//     &current=wind_speed_10m,wind_direction_10m
//
// We sample a 5×5 grid of points across the bbox in parallel (25 fetches).
// Each grid cell stores a (u, v) vector in m/s, with `u` pointing east
// and `v` pointing north (standard meteorological "TO" convention — note
// that wind_direction_10m is the "FROM" direction so we add 180°).
//
// Bilinear interpolation sampleWind() is exposed so the CA / embers can
// query a wind vector at any (lat, lon) inside the bbox.
//
// Failure handling: any of the 25 calls failing causes the whole promise
// to reject so the caller can drop back to a uniform vector. We time out
// each fetch at 4 s (judges won't wait).

import type { Bbox, LatLon } from "../geo/bbox";

export interface WindGrid {
  /** 5×5 east-pointing wind component (m/s). Row-major. */
  uMs: Float32Array;
  /** 5×5 north-pointing wind component (m/s). Row-major. */
  vMs: Float32Array;
  /** [rows, cols] — typically [5, 5]. */
  gridDims: [number, number];
  bbox: Bbox;
  /** "open-meteo" when live, "fallback" when uniform. */
  source: "open-meteo" | "fallback";
  fetchedAt: string;
}

export interface WindVector {
  /** East-pointing component (m/s). Positive = eastward. */
  u: number;
  /** North-pointing component (m/s). Positive = northward. */
  v: number;
}

export const DEFAULT_GRID_DIM = 5;
const FETCH_TIMEOUT_MS = 4000;

// ─────────────── Conversions ───────────────

/**
 * Open-Meteo returns wind_direction_10m in degrees clockwise from north,
 * representing the direction the wind is BLOWING FROM. Convert that
 * (speed, fromDir) pair into (u, v) where u points east and v points
 * north (the direction the wind is blowing TO).
 */
export function speedDirToUv(
  speedMs: number,
  fromDirDeg: number,
): WindVector {
  // The "to" direction is fromDir + 180°. u = sin(toRad)*speed,
  // v = cos(toRad)*speed (standard meteorological convention).
  const toRad = ((fromDirDeg + 180) * Math.PI) / 180;
  return {
    u: Math.sin(toRad) * speedMs,
    v: Math.cos(toRad) * speedMs,
  };
}

/** Reverse of speedDirToUv — useful for legacy windDirDeg/windSpeedMs props. */
export function uvToSpeedDir(u: number, v: number): {
  speedMs: number;
  fromDirDeg: number;
} {
  const speedMs = Math.hypot(u, v);
  // Direction the wind is blowing TO (radians from north).
  const toRad = Math.atan2(u, v);
  let toDeg = (toRad * 180) / Math.PI;
  if (toDeg < 0) toDeg += 360;
  let fromDeg = toDeg + 180;
  if (fromDeg >= 360) fromDeg -= 360;
  return { speedMs, fromDirDeg: fromDeg };
}

// ─────────────── Sampling ───────────────

/**
 * Bilinear-interpolate the wind grid at a (lat, lon). Out-of-range
 * samples clamp to the nearest edge.
 */
export function sampleWind(grid: WindGrid, lat: number, lon: number): WindVector {
  const [rows, cols] = grid.gridDims;
  const { bbox } = grid;
  const fx = (lon - bbox.west) / (bbox.east - bbox.west);
  // Latitude grows north → top of the grid (row 0) is the NORTH edge.
  const fy = (bbox.north - lat) / (bbox.north - bbox.south);
  const x = Math.max(0, Math.min(cols - 1, fx * (cols - 1)));
  const y = Math.max(0, Math.min(rows - 1, fy * (rows - 1)));
  const x0 = Math.floor(x);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(rows - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const lerp4 = (a00: number, a10: number, a01: number, a11: number): number =>
    a00 * (1 - dx) * (1 - dy) +
    a10 * dx * (1 - dy) +
    a01 * (1 - dx) * dy +
    a11 * dx * dy;
  const idx = (j: number, i: number): number => j * cols + i;
  const u = lerp4(
    grid.uMs[idx(y0, x0)]!,
    grid.uMs[idx(y0, x1)]!,
    grid.uMs[idx(y1, x0)]!,
    grid.uMs[idx(y1, x1)]!,
  );
  const v = lerp4(
    grid.vMs[idx(y0, x0)]!,
    grid.vMs[idx(y0, x1)]!,
    grid.vMs[idx(y1, x0)]!,
    grid.vMs[idx(y1, x1)]!,
  );
  return { u, v };
}

/** Generate the (lat, lon) sample points for an N×N grid across the bbox. */
export function gridSamplePoints(
  bbox: Bbox,
  rows: number = DEFAULT_GRID_DIM,
  cols: number = DEFAULT_GRID_DIM,
): LatLon[] {
  const out: LatLon[] = [];
  for (let j = 0; j < rows; j++) {
    const fy = rows === 1 ? 0.5 : j / (rows - 1);
    const lat = bbox.north - fy * (bbox.north - bbox.south);
    for (let i = 0; i < cols; i++) {
      const fx = cols === 1 ? 0.5 : i / (cols - 1);
      const lon = bbox.west + fx * (bbox.east - bbox.west);
      out.push({ lat, lon });
    }
  }
  return out;
}

// ─────────────── Network ───────────────

interface OpenMeteoResponse {
  current?: {
    wind_speed_10m?: number;
    wind_direction_10m?: number;
  };
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

async function fetchWindAt(lat: number, lon: number): Promise<WindVector> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}` +
    `&longitude=${lon.toFixed(4)}&current=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms`;
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  const json = (await res.json()) as OpenMeteoResponse;
  const speed = json.current?.wind_speed_10m;
  const dir = json.current?.wind_direction_10m;
  if (typeof speed !== "number" || typeof dir !== "number") {
    throw new Error("open-meteo: missing wind fields");
  }
  return speedDirToUv(speed, dir);
}

/**
 * Build a WindGrid by fetching Open-Meteo at each of N×N points in parallel.
 * Throws if ANY fetch fails — the caller should catch and fall back.
 */
export async function loadWindGrid(
  bbox: Bbox,
  rows: number = DEFAULT_GRID_DIM,
  cols: number = DEFAULT_GRID_DIM,
): Promise<WindGrid> {
  const points = gridSamplePoints(bbox, rows, cols);
  const results = await Promise.all(points.map((p) => fetchWindAt(p.lat, p.lon)));
  const uMs = new Float32Array(rows * cols);
  const vMs = new Float32Array(rows * cols);
  for (let i = 0; i < results.length; i++) {
    uMs[i] = results[i]!.u;
    vMs[i] = results[i]!.v;
  }
  return {
    uMs,
    vMs,
    gridDims: [rows, cols],
    bbox,
    source: "open-meteo",
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Build a uniform fallback grid from a single (windDirDeg, windSpeedMs)
 * vector — used when the Open-Meteo fetch fails or no wind data is
 * available. Every cell stores the same (u, v) so sampleWind() returns
 * a constant vector.
 */
export function uniformWindGrid(
  bbox: Bbox,
  windDirDeg: number,
  windSpeedMs: number,
  rows: number = DEFAULT_GRID_DIM,
  cols: number = DEFAULT_GRID_DIM,
): WindGrid {
  const { u, v } = speedDirToUv(windSpeedMs, windDirDeg);
  const uMs = new Float32Array(rows * cols).fill(u);
  const vMs = new Float32Array(rows * cols).fill(v);
  return {
    uMs,
    vMs,
    gridDims: [rows, cols],
    bbox,
    source: "fallback",
    fetchedAt: new Date().toISOString(),
  };
}
