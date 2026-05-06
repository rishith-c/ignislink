// Project FIRMS hotspots (lat/lon) into the 3D scene's local coordinate
// space. The 3D scene's terrain is a square mesh of side `terrainSize`
// centered on the origin: x ∈ [-terrainSize/2 .. terrainSize/2] and
// z ∈ [-terrainSize/2 .. terrainSize/2].
//
// We use a simple linear interpolation against the bbox — fine for tiles
// of a few km. The longitude axis maps to scene-x and the latitude axis
// maps to scene-z. Latitude is INVERTED (north-up = -z) so the visual
// "north" of the scene matches a user's mental compass.

import type { FirmsBbox, FirmsHotspot } from "./client";

/** Default terrain extent matching FireSimulator3D's TERRAIN_SIZE. */
export const DEFAULT_TERRAIN_SIZE = 40;

export interface ProjectedHotspot {
  /** Scene x coordinate (-terrainSize/2 .. terrainSize/2). */
  x: number;
  /** Scene z coordinate (-terrainSize/2 .. terrainSize/2). */
  z: number;
  /** Source latitude (degrees). */
  lat: number;
  /** Source longitude (degrees). */
  lon: number;
  /** Fire Radiative Power (MW). */
  frp: number;
  /** Confidence bucket. */
  confidence: "low" | "nominal" | "high";
  /** Brightness (Kelvin). */
  brightTi4?: number;
  /** Stable identifier — index-based when none is provided. */
  id: string;
  /** Human-friendly label, e.g., a nearest-place name. */
  label?: string;
}

export interface ProjectOptions {
  bbox: FirmsBbox;
  terrainSize?: number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Project a single (lat, lon) point into scene coordinates.
 *
 * The mapping is:
 *   x = lerp(-S/2, S/2, (lon - west) / (east - west))
 *   z = lerp( S/2, -S/2, (lat - south) / (north - south))
 *
 * That is, lon increases left→right (x grows), lat increases bottom→top
 * (z DECREASES — three.js's right-handed coords + our top-down camera).
 */
export function projectLatLon(
  lat: number,
  lon: number,
  opts: ProjectOptions,
): { x: number; z: number } {
  const size = opts.terrainSize ?? DEFAULT_TERRAIN_SIZE;
  const half = size / 2;
  const { west, east, south, north } = opts.bbox;
  const lonSpan = east - west;
  const latSpan = north - south;
  if (lonSpan <= 0 || latSpan <= 0) {
    return { x: 0, z: 0 };
  }
  const u = (lon - west) / lonSpan; // 0..1 west→east
  const v = (lat - south) / latSpan; // 0..1 south→north
  const x = clamp(-half + u * size, -half, half);
  // INVERT: north should map to -z so the camera's natural "up" is north.
  const z = clamp(half - v * size, -half, half);
  return { x, z };
}

/** Inverse of `projectLatLon` — useful for tests. */
export function unprojectXZ(
  x: number,
  z: number,
  opts: ProjectOptions,
): { lat: number; lon: number } {
  const size = opts.terrainSize ?? DEFAULT_TERRAIN_SIZE;
  const half = size / 2;
  const { west, east, south, north } = opts.bbox;
  const u = (x + half) / size;
  const v = (half - z) / size;
  const lon = west + u * (east - west);
  const lat = south + v * (north - south);
  return { lat, lon };
}

/**
 * Project FIRMS hotspots into scene coordinates. Returns immutable copies
 * (no mutation of the inputs).
 */
export function projectHotspots(
  hotspots: ReadonlyArray<FirmsHotspot>,
  opts: ProjectOptions,
): ProjectedHotspot[] {
  return hotspots.map((h, i) => {
    const { x, z } = projectLatLon(h.latitude, h.longitude, opts);
    return {
      id: `firms_${i}_${h.acqDate}_${h.acqTime}`,
      lat: h.latitude,
      lon: h.longitude,
      x,
      z,
      frp: h.frp,
      confidence: h.confidence,
      brightTi4: h.brightTi4,
    };
  });
}

/**
 * Compute the smallest bbox covering a set of (lat, lon) points, padded
 * by `paddingDeg` on each side. Returns `null` if the input is empty.
 */
export function bboxFromPoints(
  points: ReadonlyArray<{ lat: number; lon: number }>,
  paddingDeg = 0.05,
): FirmsBbox | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return null;
  // Guarantee a non-zero span even when all points coincide.
  const latSpan = Math.max(maxLat - minLat, paddingDeg);
  const lonSpan = Math.max(maxLon - minLon, paddingDeg);
  const cx = (minLon + maxLon) / 2;
  const cy = (minLat + maxLat) / 2;
  return {
    west: cx - lonSpan / 2 - paddingDeg,
    east: cx + lonSpan / 2 + paddingDeg,
    south: cy - latSpan / 2 - paddingDeg,
    north: cy + latSpan / 2 + paddingDeg,
  };
}
