// Cal Fire / WildCAD active-incident match.
// Public JSON feed: https://incidents.fire.ca.gov/imapdata/mapdataall.json
// Updated by Cal Fire roughly every 15 min. Includes containment, acres,
// crews, structures threatened.

export interface CalFireIncident {
  Name: string;
  UniqueId: string;
  Latitude: number;
  Longitude: number;
  Started: string;
  Updated: string;
  AcresBurned: number | null;
  PercentContained: number | null;
  IsActive: boolean;
  AdminUnit?: string;
  County?: string;
  Type?: string;
}

export interface CalFireCrossCheck {
  ok: boolean;
  /** Closest active incident if within 25 km. */
  match: CalFireIncident | null;
  matchDistanceKm: number | null;
  fetchedAt: string;
  error?: string;
}

function calfireFeedUrl(): string {
  const year = new Date().getUTCFullYear();
  return `https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=true&year=${year}`;
}

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

let cache: { fetchedAt: number; incidents: CalFireIncident[] } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadCalFireFeed(): Promise<CalFireIncident[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.incidents;
  const res = await fetch(calfireFeedUrl(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; ignislink/0.1)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Cal Fire feed HTTP ${res.status}`);
  const raw = (await res.json()) as unknown;
  const arr = Array.isArray(raw) ? raw : [];
  const incidents: CalFireIncident[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const i = item as Record<string, unknown>;
    const lat = Number(i.Latitude);
    const lon = Number(i.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    incidents.push({
      Name: String(i.Name ?? ""),
      UniqueId: String(i.UniqueId ?? ""),
      Latitude: lat,
      Longitude: lon,
      Started: String(i.Started ?? ""),
      Updated: String(i.Updated ?? ""),
      AcresBurned: typeof i.AcresBurned === "number" ? i.AcresBurned : null,
      PercentContained: typeof i.PercentContained === "number" ? i.PercentContained : null,
      IsActive: Boolean(i.IsActive),
      AdminUnit: i.AdminUnit ? String(i.AdminUnit) : undefined,
      County: i.County ? String(i.County) : undefined,
      Type: i.Type ? String(i.Type) : undefined,
    });
  }
  cache = { fetchedAt: Date.now(), incidents };
  return incidents;
}

export async function crossCheckCalFire(opts: {
  lat: number;
  lon: number;
  state?: string;
}): Promise<CalFireCrossCheck> {
  const fetchedAt = new Date().toISOString();
  if (opts.state && opts.state !== "CA") {
    return {
      ok: true,
      match: null,
      matchDistanceKm: null,
      fetchedAt,
    };
  }
  try {
    const incidents = await loadCalFireFeed();
    let best: { incident: CalFireIncident; distance: number } | null = null;
    for (const inc of incidents) {
      const d = haversineKm(opts.lat, opts.lon, inc.Latitude, inc.Longitude);
      if (!best || d < best.distance) {
        best = { incident: inc, distance: d };
      }
    }
    if (!best || best.distance > 25) {
      return { ok: true, match: null, matchDistanceKm: null, fetchedAt };
    }
    return {
      ok: true,
      match: best.incident,
      matchDistanceKm: best.distance,
      fetchedAt,
    };
  } catch (err) {
    return {
      ok: false,
      match: null,
      matchDistanceKm: null,
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
