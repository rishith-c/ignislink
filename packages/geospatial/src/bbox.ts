export type LngLat = readonly [number, number];

export interface BBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

const EARTH_RADIUS_KM = 6371.0088;

export function bboxFromPoint(point: LngLat, radiusKm: number): BBox {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new Error("bboxFromPoint: lng/lat must be finite numbers");
  }
  if (point[1] < -90 || point[1] > 90) {
    throw new Error("bboxFromPoint: lat out of range [-90, 90]");
  }
  if (radiusKm <= 0) {
    throw new Error("bboxFromPoint: radiusKm must be > 0");
  }

  const [lng, lat] = point;
  const latRad = (lat * Math.PI) / 180;
  const dLatDeg = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const dLngDeg = dLatDeg / Math.max(Math.cos(latRad), 1e-9);

  return Object.freeze({
    west: lng - dLngDeg,
    south: Math.max(-90, lat - dLatDeg),
    east: lng + dLngDeg,
    north: Math.min(90, lat + dLatDeg),
  });
}
