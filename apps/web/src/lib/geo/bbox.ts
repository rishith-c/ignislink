// Lightweight bounding-box helpers for the SENTRY 3D scene.
//
// `Bbox` matches Agent A's expected `{west, south, east, north}` interface
// so the prop wiring is identical when their FIRMS branch lands.
//
// computeBbox accepts any array of {lat, lon} and returns a square-ish bbox
// padded by `padDeg` (default 0.05° ≈ 5.5 km). When the array is empty we
// return a sensible Sierra-Nevada default so the 3D scene still gets a
// real DEM tile to render (rather than crashing on empty input).

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LatLon {
  lat: number;
  lon: number;
}

const DEFAULT_BBOX: Bbox = {
  // ~5 km square around Pollock Pines, CA (matches the DEFAULT_LANDMARKS
  // in FireSimulator3D so the rendered terrain is recognisable).
  west: -120.45,
  south: 38.67,
  east: -120.39,
  north: 38.71,
};

export function computeBbox(points: ReadonlyArray<LatLon>, padDeg: number = 0.025): Bbox {
  if (!points || points.length === 0) {
    return { ...DEFAULT_BBOX };
  }
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
  if (!Number.isFinite(minLat)) {
    return { ...DEFAULT_BBOX };
  }
  return {
    west: minLon - padDeg,
    south: minLat - padDeg,
    east: maxLon + padDeg,
    north: maxLat + padDeg,
  };
}

export function bboxCenter(bbox: Bbox): LatLon {
  return {
    lat: (bbox.south + bbox.north) / 2,
    lon: (bbox.west + bbox.east) / 2,
  };
}

export function bboxKey(bbox: Bbox, zoom: number): string {
  // Deterministic stringification for caching keys. Round to 5 decimals
  // (≈1.1 m at the equator) — more than enough resolution for a 5 km tile.
  const r = (n: number): string => n.toFixed(5);
  return `${r(bbox.west)},${r(bbox.south)},${r(bbox.east)},${r(bbox.north)}|z${zoom}`;
}
