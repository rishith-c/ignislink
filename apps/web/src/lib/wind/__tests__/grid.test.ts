import { describe, expect, it } from "vitest";

import {
  gridSamplePoints,
  sampleWind,
  speedDirToUv,
  uniformWindGrid,
  uvToSpeedDir,
  type WindGrid,
} from "../grid";

const BBOX = { west: 0, south: 0, east: 4, north: 4 };

function makeGrid(uMs: number[], vMs: number[]): WindGrid {
  return {
    uMs: new Float32Array(uMs),
    vMs: new Float32Array(vMs),
    gridDims: [Math.sqrt(uMs.length), Math.sqrt(uMs.length)],
    bbox: BBOX,
    source: "open-meteo",
    fetchedAt: "2026-05-01T00:00:00Z",
  };
}

describe("speedDirToUv", () => {
  it("treats wind_direction_10m as the FROM convention", () => {
    // Wind FROM north (0°) means it blows TO the south → v negative, u ~0.
    const v0 = speedDirToUv(10, 0);
    expect(v0.u).toBeCloseTo(0, 6);
    expect(v0.v).toBeCloseTo(-10, 6);

    // Wind FROM east (90°) → blows TO west → u negative, v ~0.
    const v90 = speedDirToUv(10, 90);
    expect(v90.u).toBeCloseTo(-10, 6);
    expect(v90.v).toBeCloseTo(0, 6);

    // Wind FROM south (180°) → blows TO north → v positive.
    const v180 = speedDirToUv(10, 180);
    expect(v180.u).toBeCloseTo(0, 5);
    expect(v180.v).toBeCloseTo(10, 5);

    // Wind FROM west (270°) → blows TO east → u positive.
    const v270 = speedDirToUv(10, 270);
    expect(v270.u).toBeCloseTo(10, 5);
    expect(v270.v).toBeCloseTo(0, 5);
  });

  it("round-trips speed/dir through uvToSpeedDir", () => {
    for (const [s, d] of [
      [5, 45],
      [12, 135],
      [3, 225],
      [8, 315],
    ]) {
      const { u, v } = speedDirToUv(s!, d!);
      const back = uvToSpeedDir(u, v);
      expect(back.speedMs).toBeCloseTo(s!, 5);
      expect(back.fromDirDeg).toBeCloseTo(d!, 4);
    }
  });
});

describe("sampleWind bilinear interpolation", () => {
  // Linear east gradient: u increases from 0 → 4 across the bbox.
  // v is constant 1.
  const grid = makeGrid(
    [
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4,
      0, 1, 2, 3, 4,
    ],
    new Array(25).fill(1),
  );

  it("returns the exact corner values when sampled at corners", () => {
    // SW corner (south=0, west=0)
    const sw = sampleWind(grid, 0, 0);
    expect(sw.u).toBeCloseTo(0, 5);
    expect(sw.v).toBeCloseTo(1, 5);

    // NE corner (north=4, east=4)
    const ne = sampleWind(grid, 4, 4);
    expect(ne.u).toBeCloseTo(4, 5);
    expect(ne.v).toBeCloseTo(1, 5);

    // SE corner
    const se = sampleWind(grid, 0, 4);
    expect(se.u).toBeCloseTo(4, 5);
    expect(se.v).toBeCloseTo(1, 5);

    // NW corner
    const nw = sampleWind(grid, 4, 0);
    expect(nw.u).toBeCloseTo(0, 5);
    expect(nw.v).toBeCloseTo(1, 5);
  });

  it("returns the mean of four corners at the bbox midpoint", () => {
    // Centre of the bbox is (lat=2, lon=2). Linear east gradient → u=2.
    const mid = sampleWind(grid, 2, 2);
    expect(mid.u).toBeCloseTo(2, 5);
    expect(mid.v).toBeCloseTo(1, 5);
  });

  it("clamps out-of-range samples to the nearest edge", () => {
    const beyond = sampleWind(grid, 100, 100);
    expect(beyond.u).toBeCloseTo(4, 5);
    expect(beyond.v).toBeCloseTo(1, 5);
    const before = sampleWind(grid, -100, -100);
    expect(before.u).toBeCloseTo(0, 5);
    expect(before.v).toBeCloseTo(1, 5);
  });

  it("bilinear-interpolates a north-south gradient", () => {
    // u=0 in the NORTH row (row 0) increasing to u=4 in the SOUTH row (row 4).
    const g = makeGrid(
      [
        0, 0, 0, 0, 0,
        1, 1, 1, 1, 1,
        2, 2, 2, 2, 2,
        3, 3, 3, 3, 3,
        4, 4, 4, 4, 4,
      ],
      new Array(25).fill(1),
    );
    // lat=3 → fy = (4-3)/4 = 0.25 → y=1.0 → exactly row 1 → u=1.
    expect(sampleWind(g, 3, 2).u).toBeCloseTo(1, 5);
    // lat=1 → fy = 0.75 → y=3.0 → row 3 → u=3.
    expect(sampleWind(g, 1, 2).u).toBeCloseTo(3, 5);
    // Halfway between rows 1 and 2 (y=1.5) → u=1.5.
    // lat that gives y=1.5: y = (4-lat)/4 * 4 = 4-lat → lat=2.5.
    expect(sampleWind(g, 2.5, 2).u).toBeCloseTo(1.5, 5);
  });
});

describe("uniformWindGrid + gridSamplePoints", () => {
  it("creates a 5×5 grid of the same vector when given a uniform fallback", () => {
    const ug = uniformWindGrid(BBOX, 270, 5);
    expect(ug.gridDims).toEqual([5, 5]);
    expect(ug.source).toBe("fallback");
    // FROM west @ 5 m/s → blowing east, u ≈ +5, v ≈ 0.
    expect(ug.uMs[0]).toBeCloseTo(5, 5);
    expect(ug.vMs[0]).toBeCloseTo(0, 5);
    // sampleWind anywhere returns the same vector.
    const sample = sampleWind(ug, 1, 2);
    expect(sample.u).toBeCloseTo(5, 5);
    expect(sample.v).toBeCloseTo(0, 5);
  });

  it("gridSamplePoints lays out a 5×5 grid spanning the bbox", () => {
    const points = gridSamplePoints(BBOX, 5, 5);
    expect(points).toHaveLength(25);
    // First point is NW corner (north=4, west=0).
    expect(points[0]!.lat).toBeCloseTo(4, 5);
    expect(points[0]!.lon).toBeCloseTo(0, 5);
    // Last point is SE corner.
    expect(points[24]!.lat).toBeCloseTo(0, 5);
    expect(points[24]!.lon).toBeCloseTo(4, 5);
  });
});
