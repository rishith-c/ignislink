// Live current-weather fetcher used by every server endpoint that needs
// real wind, humidity, temperature, or 10-day precip totals. No API key
// required (Open-Meteo is free for non-commercial use). 3.5 s timeout +
// graceful null return so callers can fall back deterministically.

export type EnvironmentalSource = "open-meteo" | "fixture-fallback";

export interface EnvironmentalInputs {
  source: EnvironmentalSource;
  sampledAt: string;
  humidityPct: number | null;
  temperatureC: number | null;
  precip10dMm: number | null;
  fuelDryness: number | null;
}

export interface LiveCurrent {
  windSpeedMs: number;
  windDirDeg: number;
  environmental: EnvironmentalInputs;
}

interface OpenMeteoResponse {
  current?: {
    time?: string;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    relative_humidity_2m?: number;
    temperature_2m?: number;
  };
  daily?: { precipitation_sum?: number[] };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function deriveFuelDryness(
  humidityPct: number | null,
  precip10dMm: number | null,
): number {
  const humidityDryness = humidityPct === null ? 0.55 : 1 - clamp01(humidityPct / 100);
  const precipDryness = precip10dMm === null ? 0.6 : 1 - clamp01(precip10dMm / 35);
  return clamp01(0.45 * humidityDryness + 0.55 * precipDryness);
}

export async function fetchOpenMeteoCurrent(lat: number, lon: number): Promise<LiveCurrent | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "wind_speed_10m,wind_direction_10m,relative_humidity_2m,temperature_2m",
    daily: "precipitation_sum",
    past_days: "10",
    forecast_days: "1",
    timezone: "UTC",
    wind_speed_unit: "ms",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: { "user-agent": "sentry-dispatcher/0.0.1" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as OpenMeteoResponse;
    const current = json.current;
    if (
      typeof current?.wind_speed_10m !== "number" ||
      typeof current.wind_direction_10m !== "number"
    ) {
      return null;
    }
    const humidityPct =
      typeof current.relative_humidity_2m === "number" ? current.relative_humidity_2m : null;
    const temperatureC =
      typeof current.temperature_2m === "number" ? current.temperature_2m : null;
    const precip10dMm =
      json.daily?.precipitation_sum?.reduce(
        (sum, value) => sum + (Number.isFinite(value) ? value : 0),
        0,
      ) ?? null;
    return {
      windSpeedMs: current.wind_speed_10m,
      windDirDeg: current.wind_direction_10m,
      environmental: {
        source: "open-meteo",
        sampledAt: current.time ?? new Date().toISOString(),
        humidityPct,
        temperatureC,
        precip10dMm,
        fuelDryness: deriveFuelDryness(humidityPct, precip10dMm),
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
