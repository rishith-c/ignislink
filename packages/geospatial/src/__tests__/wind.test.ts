import { describe, it, expect } from "vitest";
import { windRoseBins } from "../wind.js";

describe("windRoseBins (meteorological direction)", () => {
  it("v>0 (wind blowing northward) reports 'from S'", () => {
    const bin = windRoseBins(0, 5);
    expect(bin.cardinal).toBe("S");
    expect(bin.speedMs).toBeCloseTo(5, 5);
  });

  it("u>0 (wind blowing eastward) reports 'from W'", () => {
    const bin = windRoseBins(5, 0);
    expect(bin.cardinal).toBe("W");
  });

  it("u<0 (wind blowing westward) reports 'from E'", () => {
    const bin = windRoseBins(-5, 0);
    expect(bin.cardinal).toBe("E");
  });

  it("v<0 (wind blowing southward) reports 'from N'", () => {
    const bin = windRoseBins(0, -5);
    expect(bin.cardinal).toBe("N");
  });

  it("returns speed via Pythagoras", () => {
    const bin = windRoseBins(3, 4);
    expect(bin.speedMs).toBeCloseTo(5, 5);
  });

  it("rejects non-finite input", () => {
    expect(() => windRoseBins(NaN, 0)).toThrow();
    expect(() => windRoseBins(0, Infinity)).toThrow();
  });
});
