import { describe, expect, it } from "vitest";

import {
  bboxFromPoints,
  DEFAULT_TERRAIN_SIZE,
  projectHotspots,
  projectLatLon,
  unprojectXZ,
} from "../project";
import type { FirmsHotspot } from "../client";

const BBOX = { west: -120.5, south: 38.6, east: -120.3, north: 38.8 };

describe("projectLatLon", () => {
  it("maps the bbox center to the scene origin", () => {
    const cx = (BBOX.west + BBOX.east) / 2;
    const cy = (BBOX.south + BBOX.north) / 2;
    const { x, z } = projectLatLon(cy, cx, { bbox: BBOX });
    expect(x).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("maps the four bbox corners to ±terrainSize/2", () => {
    const half = DEFAULT_TERRAIN_SIZE / 2;
    // SW = (south, west) → bottom-left → x = -half, z = +half
    expect(projectLatLon(BBOX.south, BBOX.west, { bbox: BBOX }).x).toBeCloseTo(-half, 6);
    expect(projectLatLon(BBOX.south, BBOX.west, { bbox: BBOX }).z).toBeCloseTo(half, 6);
    // NE = (north, east) → top-right → x = +half, z = -half
    expect(projectLatLon(BBOX.north, BBOX.east, { bbox: BBOX }).x).toBeCloseTo(half, 6);
    expect(projectLatLon(BBOX.north, BBOX.east, { bbox: BBOX }).z).toBeCloseTo(-half, 6);
    // NW
    expect(projectLatLon(BBOX.north, BBOX.west, { bbox: BBOX }).x).toBeCloseTo(-half, 6);
    expect(projectLatLon(BBOX.north, BBOX.west, { bbox: BBOX }).z).toBeCloseTo(-half, 6);
    // SE
    expect(projectLatLon(BBOX.south, BBOX.east, { bbox: BBOX }).x).toBeCloseTo(half, 6);
    expect(projectLatLon(BBOX.south, BBOX.east, { bbox: BBOX }).z).toBeCloseTo(half, 6);
  });

  it("respects a custom terrain size", () => {
    const size = 100;
    const half = size / 2;
    expect(projectLatLon(BBOX.north, BBOX.east, { bbox: BBOX, terrainSize: size }).x).toBeCloseTo(
      half,
      6,
    );
    expect(projectLatLon(BBOX.south, BBOX.west, { bbox: BBOX, terrainSize: size }).x).toBeCloseTo(
      -half,
      6,
    );
  });

  it("clamps points outside the bbox into the terrain extent", () => {
    const half = DEFAULT_TERRAIN_SIZE / 2;
    const farNE = projectLatLon(BBOX.north + 1, BBOX.east + 1, { bbox: BBOX });
    expect(farNE.x).toBeCloseTo(half, 6);
    expect(farNE.z).toBeCloseTo(-half, 6);
  });

  it("returns origin when the bbox is degenerate", () => {
    const degenerate = { west: 0, east: 0, south: 0, north: 0 };
    const { x, z } = projectLatLon(0.5, 0.5, { bbox: degenerate });
    expect(x).toBe(0);
    expect(z).toBe(0);
  });
});

describe("projectLatLon ↔ unprojectXZ round trip", () => {
  it("recovers the input lat/lon to high precision", () => {
    const cases: Array<[number, number]> = [
      [38.65, -120.42],
      [38.78, -120.31],
      [38.61, -120.49],
    ];
    for (const [lat, lon] of cases) {
      const { x, z } = projectLatLon(lat, lon, { bbox: BBOX });
      const back = unprojectXZ(x, z, { bbox: BBOX });
      expect(back.lat).toBeCloseTo(lat, 8);
      expect(back.lon).toBeCloseTo(lon, 8);
    }
  });
});

describe("projectHotspots", () => {
  it("projects every hotspot and preserves FRP / confidence", () => {
    const hotspots: FirmsHotspot[] = [
      {
        latitude: 38.7,
        longitude: -120.4,
        brightTi4: 350,
        scan: 0.4,
        track: 0.4,
        acqDate: "2026-05-01",
        acqTime: "2104",
        confidence: "high",
        frp: 250,
      },
      {
        latitude: 38.65,
        longitude: -120.45,
        brightTi4: 320,
        scan: 0.4,
        track: 0.4,
        acqDate: "2026-05-01",
        acqTime: "2104",
        confidence: "low",
        frp: 35,
      },
    ];
    const projected = projectHotspots(hotspots, { bbox: BBOX });
    expect(projected).toHaveLength(2);
    expect(projected[0]?.frp).toBe(250);
    expect(projected[0]?.confidence).toBe("high");
    expect(projected[1]?.confidence).toBe("low");
    // Ensure x/z are inside the terrain extent.
    const half = DEFAULT_TERRAIN_SIZE / 2;
    for (const p of projected) {
      expect(p.x).toBeGreaterThanOrEqual(-half);
      expect(p.x).toBeLessThanOrEqual(half);
      expect(p.z).toBeGreaterThanOrEqual(-half);
      expect(p.z).toBeLessThanOrEqual(half);
    }
  });
});

describe("bboxFromPoints", () => {
  it("returns null on empty input", () => {
    expect(bboxFromPoints([])).toBeNull();
  });

  it("computes the smallest covering bbox with padding", () => {
    const pts = [
      { lat: 38.65, lon: -120.45 },
      { lat: 38.75, lon: -120.32 },
      { lat: 38.7, lon: -120.4 },
    ];
    const bb = bboxFromPoints(pts, 0.01);
    expect(bb).not.toBeNull();
    if (!bb) throw new Error("bbox null");
    expect(bb.west).toBeLessThan(-120.45);
    expect(bb.east).toBeGreaterThan(-120.32);
    expect(bb.south).toBeLessThan(38.65);
    expect(bb.north).toBeGreaterThan(38.75);
  });

  it("guarantees a non-zero span when all points coincide", () => {
    const bb = bboxFromPoints([{ lat: 38.7, lon: -120.4 }], 0.05);
    expect(bb).not.toBeNull();
    if (!bb) throw new Error("bbox null");
    expect(bb.east - bb.west).toBeGreaterThan(0);
    expect(bb.north - bb.south).toBeGreaterThan(0);
  });
});
