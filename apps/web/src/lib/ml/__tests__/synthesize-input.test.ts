import { describe, expect, it } from "vitest";

import {
  C_INPUT,
  CHANNEL_INDEX,
  T_DEFAULT,
  synthesizeFireSpreadInput,
} from "../synthesize-input";

const HEIGHT = 8;
const WIDTH = 8;
const PIXELS = HEIGHT * WIDTH;
const SLICE_LEN = C_INPUT * PIXELS;

function makeBurn(mask: number[][]): Float32Array {
  const out = new Float32Array(PIXELS);
  for (let j = 0; j < HEIGHT; j++) {
    for (let i = 0; i < WIDTH; i++) {
      out[j * WIDTH + i] = mask[j]![i]!;
    }
  }
  return out;
}

describe("synthesizeFireSpreadInput", () => {
  it("returns a (1, T, 14, H, W) tensor with the documented default shape", () => {
    const burn = new Float32Array(PIXELS);
    const result = synthesizeFireSpreadInput({
      burnMask: burn,
      height: HEIGHT,
      width: WIDTH,
      windU: 0,
      windV: 0,
    });
    expect(result.shape).toEqual([1, T_DEFAULT, C_INPUT, HEIGHT, WIDTH]);
    expect(result.data).toBeInstanceOf(Float32Array);
    expect(result.data.length).toBe(T_DEFAULT * SLICE_LEN);
  });

  it("places ignition cells exactly on channel 0 with value 1", () => {
    const mask = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => 0));
    mask[3]![4] = 1;
    mask[5]![1] = 1;
    const burn = makeBurn(mask);

    const result = synthesizeFireSpreadInput({
      burnMask: burn,
      height: HEIGHT,
      width: WIDTH,
      windU: 0,
      windV: 0,
    });

    // Inspect every timestep — the slice should be repeated identically.
    for (let t = 0; t < T_DEFAULT; t++) {
      const tsBase = t * SLICE_LEN;
      const ch0Base = tsBase + CHANNEL_INDEX.burnMask * PIXELS;
      expect(result.data[ch0Base + (3 * WIDTH + 4)]).toBe(1);
      expect(result.data[ch0Base + (5 * WIDTH + 1)]).toBe(1);
      // Adjacent unburnt cells must remain 0.
      expect(result.data[ch0Base + (3 * WIDTH + 5)]).toBe(0);
      expect(result.data[ch0Base + 0]).toBe(0);
    }
  });

  it("writes wind components, RH, and fuel index into the correct channels", () => {
    const burn = new Float32Array(PIXELS);
    const result = synthesizeFireSpreadInput({
      burnMask: burn,
      height: HEIGHT,
      width: WIDTH,
      windU: 3.5,
      windV: -2.25,
      relativeHumidity: 0.6,
      fuelModel: 9,
    });

    const ch = (index: number, p = 0): number => {
      const tsBase = 0; // first timestep
      return result.data[tsBase + index * PIXELS + p]!;
    };

    expect(ch(CHANNEL_INDEX.windU)).toBeCloseTo(3.5, 6);
    expect(ch(CHANNEL_INDEX.windV)).toBeCloseTo(-2.25, 6);
    expect(ch(CHANNEL_INDEX.relativeHumidity)).toBeCloseTo(0.6, 6);
    expect(ch(CHANNEL_INDEX.fuelModel)).toBe(9);
    expect(ch(CHANNEL_INDEX.rothermelRos)).toBe(0);
  });

  it("encodes slope and aspect via sin and cos pairs", () => {
    const burn = new Float32Array(PIXELS);
    const slope = 0.5;
    const aspect = 1.2;
    const result = synthesizeFireSpreadInput({
      burnMask: burn,
      height: HEIGHT,
      width: WIDTH,
      windU: 0,
      windV: 0,
      slopeRad: slope,
      aspectRad: aspect,
    });

    const ch = (index: number): number => result.data[index * PIXELS]!;
    expect(ch(CHANNEL_INDEX.slopeSin)).toBeCloseTo(Math.sin(slope), 6);
    expect(ch(CHANNEL_INDEX.slopeCos)).toBeCloseTo(Math.cos(slope), 6);
    expect(ch(CHANNEL_INDEX.aspectSin)).toBeCloseTo(Math.sin(aspect), 6);
    expect(ch(CHANNEL_INDEX.aspectCos)).toBeCloseTo(Math.cos(aspect), 6);
  });

  it("repeats the timestep slice identically for every t in the sequence", () => {
    const mask = Array.from({ length: HEIGHT }, () => Array.from({ length: WIDTH }, () => 0));
    mask[2]![2] = 1;
    const burn = makeBurn(mask);

    const result = synthesizeFireSpreadInput({
      burnMask: burn,
      height: HEIGHT,
      width: WIDTH,
      windU: 1,
      windV: 1,
    });

    const slice0 = result.data.slice(0, SLICE_LEN);
    for (let t = 1; t < T_DEFAULT; t++) {
      const sliceT = result.data.slice(t * SLICE_LEN, (t + 1) * SLICE_LEN);
      expect(sliceT).toEqual(slice0);
    }
  });

  it("clamps burn-mask values to [0, 1] without mutating input", () => {
    const burn = new Float32Array(PIXELS);
    burn[0] = 1.4;
    burn[1] = -0.3;
    burn[2] = 0.7;
    const result = synthesizeFireSpreadInput({
      burnMask: burn,
      height: HEIGHT,
      width: WIDTH,
      windU: 0,
      windV: 0,
    });
    const base = CHANNEL_INDEX.burnMask * PIXELS;
    expect(result.data[base + 0]).toBe(1);
    expect(result.data[base + 1]).toBe(0);
    expect(result.data[base + 2]).toBeCloseTo(0.7, 6);
    // Source array should be untouched. Float32 is lossy so we compare with
    // tolerance rather than strict equality.
    expect(burn[0]).toBeCloseTo(1.4, 5);
    expect(burn[1]).toBeCloseTo(-0.3, 6);
  });

  it("rejects mismatched burn-mask lengths and non-positive dims", () => {
    expect(() =>
      synthesizeFireSpreadInput({
        burnMask: new Float32Array(10),
        height: HEIGHT,
        width: WIDTH,
        windU: 0,
        windV: 0,
      }),
    ).toThrow(/burnMask length/);

    expect(() =>
      synthesizeFireSpreadInput({
        burnMask: new Float32Array(0),
        height: 0,
        width: WIDTH,
        windU: 0,
        windV: 0,
      }),
    ).toThrow(/height\/width/);
  });
});
