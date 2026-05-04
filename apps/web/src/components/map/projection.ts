"use client";

// Albers USA projection — same one us-atlas/states-albers-10m.json is baked
// against. It outputs to a 975×610 canvas. Imported here so we can plot
// hotspots (lat/lon) directly into the same pixel space as the state paths.

import { geoAlbersUsa, geoPath } from "d3-geo";

export const ALBERS_WIDTH = 975;
export const ALBERS_HEIGHT = 610;

// us-atlas/states-albers-10m.json is pre-projected with the default Albers
// USA projection scaled to fit in 975×610. We recreate that here for
// projecting individual lon/lat points into the same pixel space.
const projection = geoAlbersUsa()
  .scale(1300)
  .translate([ALBERS_WIDTH / 2, ALBERS_HEIGHT / 2]);

export const albersPath = geoPath(projection);

/** Project [lon, lat] → [x, y] in the 975×610 viewbox. Returns null for
 *  points outside the projection range (e.g. far offshore). */
export function projectLonLat(lon: number, lat: number): [number, number] | null {
  const result = projection([lon, lat]);
  if (!result) return null;
  return [result[0], result[1]];
}
