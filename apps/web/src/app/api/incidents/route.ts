import { NextResponse } from "next/server";
import { FIXTURE_INCIDENTS, type FixtureIncident } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

type EnvironmentalInputs = {
  source: "open-meteo" | "fixture-fallback";
  sampledAt: string;
  humidityPct: number | null;
  temperatureC: number | null;
  precip10dMm: number | null;
  fuelDryness: number | null;
};

type IncidentResponse = Omit<FixtureIncident, "observedAt"> & {
  observedAt: string;
  environmental: EnvironmentalInputs;
};

type OpenMeteoResponse = {
  current?: {
    time?: string;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    relative_humidity_2m?: number;
    temperature_2m?: number;
  };
  daily?: {
    precipitation_sum?: number[];
  };
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function deriveFuelDryness(humidityPct: number | null, precip10dMm: number | null): number | null {
  if (humidityPct === null && precip10dMm === null) return null;
  const humidityDryness = humidityPct === null ? 0.6 : 1 - clamp01(humidityPct / 100);
  const precipDryness = precip10dMm === null ? 0.6 : 1 - clamp01(precip10dMm / 35);
  return clamp01(0.45 * humidityDryness + 0.55 * precipDryness);
}

async function fetchOpenMeteoEnvironmental(incident: FixtureIncident): Promise<{
  windSpeedMs: number;
  windDirDeg: number;
  environmental: EnvironmentalInputs;
} | null> {
  const params = new URLSearchParams({
    latitude: incident.lat.toFixed(4),
    longitude: incident.lon.toFixed(4),
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
    const temperatureC = typeof current.temperature_2m === "number" ? current.temperature_2m : null;
    const precip10dMm =
      json.daily?.precipitation_sum?.reduce(
        (sum, value) => sum + (Number.isFinite(value) ? value : 0),
        0,
      ) ?? null;
    const fuelDryness = deriveFuelDryness(humidityPct, precip10dMm);
    return {
      windSpeedMs: current.wind_speed_10m,
      windDirDeg: current.wind_direction_10m,
      environmental: {
        source: "open-meteo",
        sampledAt: current.time ?? new Date().toISOString(),
        humidityPct,
        temperatureC,
        precip10dMm,
        fuelDryness,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fallbackIncident(incident: FixtureIncident): IncidentResponse {
  return {
    ...incident,
    observedAt: incident.observedAt.toISOString(),
    environmental: {
      source: "fixture-fallback",
      sampledAt: incident.observedAt.toISOString(),
      humidityPct: null,
      temperatureC: null,
      precip10dMm: null,
      fuelDryness: null,
    },
  };
}

export async function GET() {
  const incidents = await Promise.all(
    FIXTURE_INCIDENTS.map(async (incident): Promise<IncidentResponse> => {
      const live = await fetchOpenMeteoEnvironmental(incident);
      if (!live) return fallbackIncident(incident);
      return {
        ...incident,
        observedAt: incident.observedAt.toISOString(),
        windSpeedMs: live.windSpeedMs,
        windDirDeg: live.windDirDeg,
        environmental: live.environmental,
      };
    }),
  );

  return NextResponse.json(
    {
      incidents,
      provenance: {
        baseDetections: "fixture-seed",
        weather: "Open-Meteo current endpoint with fixture fallback",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
