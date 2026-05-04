import { describe, it, expect } from "vitest";
import { bboxFromPoint } from "../bbox.js";

describe("bboxFromPoint", () => {
  it("produces a roughly square bbox at the equator", () => {
    const bbox = bboxFromPoint([0, 0], 100);
    expect(bbox.east - bbox.west).toBeCloseTo(bbox.north - bbox.south, 5);
  });

  it("produces a wider lng span at high latitude", () => {
    const equator = bboxFromPoint([0, 0], 100);
    const arctic = bboxFromPoint([0, 75], 100);
    const equatorLngSpan = equator.east - equator.west;
    const arcticLngSpan = arctic.east - arctic.west;
    expect(arcticLngSpan).toBeGreaterThan(equatorLngSpan);
  });

  it("clamps north/south to ±90", () => {
    const bbox = bboxFromPoint([0, 89.5], 1000);
    expect(bbox.north).toBeLessThanOrEqual(90);
    expect(bbox.south).toBeGreaterThanOrEqual(-90);
  });

  it("rejects invalid input", () => {
    expect(() => bboxFromPoint([NaN, 0], 10)).toThrow();
    expect(() => bboxFromPoint([0, 91], 10)).toThrow();
    expect(() => bboxFromPoint([0, 0], 0)).toThrow();
    expect(() => bboxFromPoint([0, 0], -1)).toThrow();
  });
});
