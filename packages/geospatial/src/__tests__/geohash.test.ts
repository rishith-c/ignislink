import { describe, it, expect } from "vitest";
import { geohashEncode } from "../geohash.js";

describe("geohashEncode", () => {
  it("matches a well-known reference value (San Francisco at precision 7)", () => {
    // SF City Hall: -122.4194, 37.7793 -> 9q8yym8
    expect(geohashEncode(-122.4194, 37.7793, 7)).toBe("9q8yym8");
  });

  it("respects precision", () => {
    const point: [number, number] = [-122.4194, 37.7793];
    expect(geohashEncode(point[0], point[1], 5)).toHaveLength(5);
    expect(geohashEncode(point[0], point[1], 9)).toHaveLength(9);
    expect(geohashEncode(point[0], point[1], 5)).toBe(
      geohashEncode(point[0], point[1], 9).slice(0, 5),
    );
  });

  it("rejects out-of-range input", () => {
    expect(() => geohashEncode(0, 91, 7)).toThrow();
    expect(() => geohashEncode(181, 0, 7)).toThrow();
    expect(() => geohashEncode(0, 0, 0)).toThrow();
    expect(() => geohashEncode(0, 0, 13)).toThrow();
    expect(() => geohashEncode(NaN, 0, 7)).toThrow();
  });

  it("public-map redaction: precision 7 collapses points within ~150 m to the same hash", () => {
    // Two points 100 m apart at SF latitude → 1 m of latitude ≈ 1.11e-5 deg
    const a = geohashEncode(-122.4194, 37.7793, 7);
    const b = geohashEncode(-122.41945, 37.77935, 7);
    expect(a).toBe(b);
  });
});
