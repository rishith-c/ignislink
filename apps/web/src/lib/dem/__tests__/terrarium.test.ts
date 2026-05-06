import { describe, expect, it } from "vitest";

import {
  decodeTerrariumPixel,
  decodeTerrariumPixels,
  pickZoom,
  resampleDem,
  sampleDem,
  type DemTile,
} from "../terrarium";

// Reference points from the Mapzen "use-service" doc: elevation_m =
// (R*256 + G + B/256) - 32768. Values chosen to span sea level, low
// positive (~50 m), high positive (~Mt Whitney 4421 m), and negative
// (~Death Valley -86 m), plus exact zero / max RGB edges.

interface Fixture {
  rgb: [number, number, number];
  expected: number;
}

const FIXTURES: Fixture[] = [
  { rgb: [128, 0, 0], expected: 0 },                // sea level
  { rgb: [128, 1, 0], expected: 1 },                // 1 m
  { rgb: [128, 50, 0], expected: 50 },              // 50 m
  { rgb: [127, 170, 0], expected: -86 },            // Death Valley
  { rgb: [145, 69, 0], expected: 4421 },            // Mt Whitney
  { rgb: [255, 255, 255], expected: 32768 - 1 + 255 / 256 },
  { rgb: [0, 0, 0], expected: -32768 },             // floor
  { rgb: [128, 0, 128], expected: 0.5 },            // sub-metre fractional
];

describe("decodeTerrariumPixel", () => {
  it("decodes the Mapzen RGB encoding for 8 known elevations", () => {
    for (const fx of FIXTURES) {
      const [r, g, b] = fx.rgb;
      const got = decodeTerrariumPixel(r, g, b);
      expect(got).toBeCloseTo(fx.expected, 6);
    }
  });

  it("handles the zero pixel as -32768 m (encoder offset)", () => {
    expect(decodeTerrariumPixel(0, 0, 0)).toBe(-32768);
  });

  it("handles the max pixel as 32767.996 m", () => {
    expect(decodeTerrariumPixel(255, 255, 255)).toBeCloseTo(
      255 * 256 + 255 + 255 / 256 - 32768,
      6,
    );
  });
});

describe("decodeTerrariumPixels", () => {
  it("decodes a packed RGBA buffer into a Float32Array", () => {
    // Build a 4-pixel RGBA buffer (alpha ignored).
    const rgba = new Uint8ClampedArray([
      128, 0, 0, 255,    // 0 m
      128, 50, 0, 255,   // 50 m
      127, 170, 0, 255,  // -86 m
      0, 0, 0, 255,      // -32768 m
    ]);
    const decoded = decodeTerrariumPixels(rgba);
    expect(decoded.length).toBe(4);
    expect(decoded[0]).toBeCloseTo(0, 6);
    expect(decoded[1]).toBeCloseTo(50, 6);
    expect(decoded[2]).toBeCloseTo(-86, 6);
    expect(decoded[3]).toBe(-32768);
  });

  it("rejects buffers whose length is not a multiple of 4", () => {
    const bad = new Uint8ClampedArray([1, 2, 3]);
    expect(() => decodeTerrariumPixels(bad)).toThrow();
  });
});

describe("pickZoom", () => {
  it("uses zoom 12 for a small ~5 km bbox", () => {
    const bbox = { west: -120.45, south: 38.67, east: -120.39, north: 38.71 };
    const z = pickZoom(bbox, 12);
    expect(z).toBeGreaterThanOrEqual(10);
    expect(z).toBeLessThanOrEqual(12);
  });

  it("downzooms a continent-sized bbox to stay within 4 tiles", () => {
    const bbox = { west: -125, south: 30, east: -100, north: 50 };
    const z = pickZoom(bbox, 12);
    expect(z).toBeLessThan(10);
  });
});

describe("sampleDem + resampleDem", () => {
  // Construct a 4×4 synthetic DEM that increases linearly east.
  function makeDem(): DemTile {
    const heights = new Float32Array([
      0, 100, 200, 300,
      0, 100, 200, 300,
      0, 100, 200, 300,
      0, 100, 200, 300,
    ]);
    return {
      heights,
      dims: [4, 4],
      bounds: { west: 0, south: 0, east: 3, north: 3 },
      zoom: 12,
    };
  }

  it("returns the corner heights when sampled at corners", () => {
    const dem = makeDem();
    expect(sampleDem(dem, 3, 0)).toBeCloseTo(0, 6);
    expect(sampleDem(dem, 3, 3)).toBeCloseTo(300, 6);
    expect(sampleDem(dem, 0, 0)).toBeCloseTo(0, 6);
    expect(sampleDem(dem, 0, 3)).toBeCloseTo(300, 6);
  });

  it("bilinear-interpolates the midpoint", () => {
    const dem = makeDem();
    expect(sampleDem(dem, 1.5, 1.5)).toBeCloseTo(150, 6);
  });

  it("clamps out-of-range samples to the nearest edge", () => {
    const dem = makeDem();
    expect(sampleDem(dem, 5, 5)).toBeCloseTo(300, 6);
    expect(sampleDem(dem, -5, -5)).toBeCloseTo(0, 6);
  });

  it("resampleDem normalises into [-vScale, +vScale]", () => {
    const dem = makeDem();
    const out = resampleDem(dem, dem.bounds, 8, 1);
    let min = Infinity;
    let max = -Infinity;
    for (const v of out) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeCloseTo(-1, 5);
    expect(max).toBeCloseTo(1, 5);
  });

  it("resampleDem returns all zeros when the DEM is flat", () => {
    const flat: DemTile = {
      heights: new Float32Array([10, 10, 10, 10]),
      dims: [2, 2],
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      zoom: 12,
    };
    const out = resampleDem(flat, flat.bounds, 4, 1);
    for (const v of out) expect(v).toBe(0);
  });
});
