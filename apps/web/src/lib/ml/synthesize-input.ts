// Build the 14-channel U-Net+ConvLSTM input tensor from the live scene state.
//
// The Python model is `ml/models/unet_convlstm.py`. We mirror its channel
// layout EXACTLY so weights baked into the ONNX graph still apply:
//
//     0   current burn mask (binary)
//     1   wind U (east component, m/s)
//     2   wind V (north component, m/s)
//     3   relative humidity (0..1)
//     4   temperature (normalized °C, divided by 40 here)
//     5   FBFM40 fuel-model index (int, embedded inside the model)
//     6   canopy cover (0..1)
//     7   canopy bulk density (normalized)
//     8   slope (radians, sin component)
//     9   slope (radians, cos component)
//     10  aspect (radians, sin component)
//     11  aspect (radians, cos component)
//     12  days-since-precip (normalized — divided by 30 here)
//     13  Rothermel ROS prior (m/s) — set to 0 in browser; we don't have a
//         python rothermel kernel here. The model's still-conditioned-on-it
//         input slot is left at zero rather than skipped so the channel index
//         is preserved.
//
// The model expects a temporal input of shape (B=1, T=4, C=14, H, W). For
// each timestep we just repeat the *current* synthesized state — we don't
// have history rasters in the browser yet. The ConvLSTM still produces a
// forward step from a constant sequence; this is the same pattern the
// FastAPI predict route uses (see `apps/api-py/src/sentry_max_api/onnx_loader.py`).

export const C_INPUT = 14;
export const T_DEFAULT = 4;

/** Per-channel index inside one (C, H, W) timestep slice. */
export const CHANNEL_INDEX = {
  burnMask: 0,
  windU: 1,
  windV: 2,
  relativeHumidity: 3,
  temperature: 4,
  fuelModel: 5,
  canopyCover: 6,
  canopyBulkDensity: 7,
  slopeSin: 8,
  slopeCos: 9,
  aspectSin: 10,
  aspectCos: 11,
  daysSincePrecip: 12,
  rothermelRos: 13,
} as const;

export interface SynthesizeOptions {
  /** Burn mask, length H*W, row-major. Values clamped to [0, 1]. */
  burnMask: Float32Array;
  /** Grid height. */
  height: number;
  /** Grid width. */
  width: number;
  /** Wind U component (east, m/s). */
  windU: number;
  /** Wind V component (north, m/s). */
  windV: number;
  /** Relative humidity, 0..1. Defaults to 0.35. */
  relativeHumidity?: number;
  /** Temperature, °C. Will be divided by 40 inside the tensor. */
  temperatureC?: number;
  /** FBFM40 fuel-model integer index, 0..40. Defaults to 6 (chaparral). */
  fuelModel?: number;
  /** Canopy cover, 0..1. Defaults to 0.45. */
  canopyCover?: number;
  /** Canopy bulk density, normalized. Defaults to 0.4. */
  canopyBulkDensity?: number;
  /** Mean terrain slope, radians. Defaults to 0.18 rad (~10°). */
  slopeRad?: number;
  /** Mean aspect, radians. Defaults to 0 rad (north-facing). */
  aspectRad?: number;
  /** Days since precipitation; divided by 30 inside the tensor. */
  daysSincePrecip?: number;
  /** Number of past timesteps to repeat (T). Defaults to 4. */
  timesteps?: number;
}

export interface SynthesizedInput {
  /** Flat tensor with shape (1, T, C, H, W). */
  data: Float32Array;
  /** Concrete shape; passed straight to onnxruntime-web's Tensor constructor. */
  shape: [1, number, number, number, number];
}

const DEFAULTS = {
  relativeHumidity: 0.35,
  temperatureC: 22,
  fuelModel: 6,
  canopyCover: 0.45,
  canopyBulkDensity: 0.4,
  slopeRad: 0.18,
  aspectRad: 0,
  daysSincePrecip: 14,
  timesteps: T_DEFAULT,
} as const;

/**
 * Build the model input tensor for a single inference call.
 *
 * The output is laid out as `(1, T, C, H, W)` with row-major H/W. Every
 * timestep is identical — we just repeat the current state because the
 * browser scene doesn't keep raster history.
 */
export function synthesizeFireSpreadInput(opts: SynthesizeOptions): SynthesizedInput {
  const { burnMask, height, width } = opts;
  if (height <= 0 || width <= 0) {
    throw new Error(
      `synthesizeFireSpreadInput: height/width must be positive (got ${height}x${width})`,
    );
  }
  const expectedLen = height * width;
  if (burnMask.length !== expectedLen) {
    throw new Error(
      `synthesizeFireSpreadInput: burnMask length ${burnMask.length} does not match height*width ${expectedLen}`,
    );
  }

  const T = opts.timesteps ?? DEFAULTS.timesteps;
  if (T <= 0) {
    throw new Error(`synthesizeFireSpreadInput: timesteps must be positive (got ${T})`);
  }

  const rh = opts.relativeHumidity ?? DEFAULTS.relativeHumidity;
  const tempC = opts.temperatureC ?? DEFAULTS.temperatureC;
  const fuel = opts.fuelModel ?? DEFAULTS.fuelModel;
  const cover = opts.canopyCover ?? DEFAULTS.canopyCover;
  const cbd = opts.canopyBulkDensity ?? DEFAULTS.canopyBulkDensity;
  const slope = opts.slopeRad ?? DEFAULTS.slopeRad;
  const aspect = opts.aspectRad ?? DEFAULTS.aspectRad;
  const dsp = opts.daysSincePrecip ?? DEFAULTS.daysSincePrecip;

  const slopeSin = Math.sin(slope);
  const slopeCos = Math.cos(slope);
  const aspectSin = Math.sin(aspect);
  const aspectCos = Math.cos(aspect);
  const tempNorm = tempC / 40;
  const dspNorm = dsp / 30;
  const fuelClamped = Math.max(0, Math.min(40, Math.round(fuel)));
  const rhClamped = Math.max(0, Math.min(1, rh));

  // Build one (C, H, W) slice once — we then memcpy it into each timestep.
  const sliceLen = C_INPUT * expectedLen;
  const slice = new Float32Array(sliceLen);

  // Channel 0: burn mask. Clamp [0,1] without mutating the source array.
  for (let p = 0; p < expectedLen; p++) {
    const v = burnMask[p] ?? 0;
    slice[CHANNEL_INDEX.burnMask * expectedLen + p] = v <= 0 ? 0 : v >= 1 ? 1 : v;
  }

  // Channels 1..13: scalar fills. Wind components use the raw m/s value;
  // the model was trained on raw m/s so we don't normalize here.
  fillChannel(slice, CHANNEL_INDEX.windU, expectedLen, opts.windU);
  fillChannel(slice, CHANNEL_INDEX.windV, expectedLen, opts.windV);
  fillChannel(slice, CHANNEL_INDEX.relativeHumidity, expectedLen, rhClamped);
  fillChannel(slice, CHANNEL_INDEX.temperature, expectedLen, tempNorm);
  fillChannel(slice, CHANNEL_INDEX.fuelModel, expectedLen, fuelClamped);
  fillChannel(slice, CHANNEL_INDEX.canopyCover, expectedLen, cover);
  fillChannel(slice, CHANNEL_INDEX.canopyBulkDensity, expectedLen, cbd);
  fillChannel(slice, CHANNEL_INDEX.slopeSin, expectedLen, slopeSin);
  fillChannel(slice, CHANNEL_INDEX.slopeCos, expectedLen, slopeCos);
  fillChannel(slice, CHANNEL_INDEX.aspectSin, expectedLen, aspectSin);
  fillChannel(slice, CHANNEL_INDEX.aspectCos, expectedLen, aspectCos);
  fillChannel(slice, CHANNEL_INDEX.daysSincePrecip, expectedLen, dspNorm);
  // Channel 13 (Rothermel ROS prior) stays at 0 — JS doesn't run rothermel.

  // Repeat the slice T times into the full (1, T, C, H, W) buffer.
  const data = new Float32Array(T * sliceLen);
  for (let t = 0; t < T; t++) {
    data.set(slice, t * sliceLen);
  }

  return {
    data,
    shape: [1, T, C_INPUT, height, width],
  };
}

function fillChannel(
  slice: Float32Array,
  channel: number,
  pixelCount: number,
  value: number,
): void {
  const start = channel * pixelCount;
  const end = start + pixelCount;
  // Float32Array#fill is significantly faster than a manual loop.
  slice.fill(value, start, end);
}
