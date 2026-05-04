export interface WindBin {
  readonly directionDeg: number;
  readonly speedMs: number;
  readonly cardinal: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
}

const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function windRoseBins(uMs: number, vMs: number): WindBin {
  if (!Number.isFinite(uMs) || !Number.isFinite(vMs)) {
    throw new Error("windRoseBins: u/v must be finite");
  }
  const speedMs = Math.hypot(uMs, vMs);
  // Meteorological convention: direction the wind is coming FROM, in degrees clockwise from North.
  // u = east-component, v = north-component. atan2 gives the vector angle; we add 180 deg to flip from "toward" to "from".
  let degFrom = (Math.atan2(uMs, vMs) * 180) / Math.PI + 180;
  if (degFrom < 0) degFrom += 360;
  if (degFrom >= 360) degFrom -= 360;
  const idx = Math.round(degFrom / 45) % 8;
  return Object.freeze({
    directionDeg: degFrom,
    speedMs,
    cardinal: CARDINALS[idx]!,
  });
}
