// NASA FIRMS satellite cross-check.
// API docs: https://firms.modaps.eosdis.nasa.gov/api/area/

export interface FirmsHit {
  latitude: number;
  longitude: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
  confidence: string;
  brightness: number;
  frp: number;
  daynight: "D" | "N";
}

export interface FirmsCrossCheck {
  ok: boolean;
  hits: FirmsHit[];
  /** Closest hit's distance in km, if any. */
  closestKm: number | null;
  /** Was the original detection corroborated within 5 km in the last 24 h? */
  matched: boolean;
  source: string;
  fetchedAt: string;
  error?: string;
}

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const sLat1 = Math.sin(dLat / 2);
  const sLon1 = Math.sin(dLon / 2);
  const a = sLat1 * sLat1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sLon1 * sLon1;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export async function crossCheckFirms(opts: {
  lat: number;
  lon: number;
  bboxRadiusKm?: number;
  source?: string;
  days?: number;
  apiKey?: string;
}): Promise<FirmsCrossCheck> {
  const lat = opts.lat;
  const lon = opts.lon;
  const radius = opts.bboxRadiusKm ?? 25;
  const source = opts.source ?? "VIIRS_NOAA20_NRT";
  const days = opts.days ?? 1;
  const apiKey = opts.apiKey ?? process.env.FIRMS_API_KEY ?? "";

  const fetchedAt = new Date().toISOString();
  if (!apiKey) {
    return {
      ok: false,
      hits: [],
      closestKm: null,
      matched: false,
      source,
      fetchedAt,
      error: "FIRMS_API_KEY not configured",
    };
  }

  // Build a small bbox around the incident — west,south,east,north.
  const dLat = radius / 111;
  const dLon = radius / (111 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
    .map((n) => n.toFixed(4))
    .join(",");

  const url = `${FIRMS_BASE}/${apiKey}/${source}/${bbox}/${days}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "sentry-max/0.1 (ops@sentry-max.io)" },
      // Don't cache the FIRMS response — satellite passes are minute-fresh.
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        hits: [],
        closestKm: null,
        matched: false,
        source,
        fetchedAt,
        error: `FIRMS HTTP ${res.status}`,
      };
    }
    const csv = await res.text();
    const hits = parseFirmsCsv(csv);
    const distances = hits
      .map((h) => haversineKm(lat, lon, h.latitude, h.longitude))
      .sort((a, b) => a - b);
    const closest = distances[0] ?? null;
    return {
      ok: true,
      hits,
      closestKm: closest,
      matched: closest !== null && closest <= 5,
      source,
      fetchedAt,
    };
  } catch (err) {
    return {
      ok: false,
      hits: [],
      closestKm: null,
      matched: false,
      source,
      fetchedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function parseFirmsCsv(csv: string): FirmsHit[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iLat = idx("latitude");
  const iLon = idx("longitude");
  const iAcqDate = idx("acq_date");
  const iAcqTime = idx("acq_time");
  const iSat = idx("satellite");
  const iConf = idx("confidence");
  const iBright = idx("bright_ti4") >= 0 ? idx("bright_ti4") : idx("brightness");
  const iFrp = idx("frp");
  const iDayNight = idx("daynight");
  const out: FirmsHit[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");
    const lat = parseFloat(parts[iLat] ?? "");
    const lon = parseFloat(parts[iLon] ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      latitude: lat,
      longitude: lon,
      acq_date: parts[iAcqDate] ?? "",
      acq_time: parts[iAcqTime] ?? "",
      satellite: parts[iSat] ?? "",
      confidence: parts[iConf] ?? "",
      brightness: parseFloat(parts[iBright] ?? "0"),
      frp: parseFloat(parts[iFrp] ?? "0"),
      daynight: (parts[iDayNight] === "N" ? "N" : "D") as "D" | "N",
    });
  }
  return out;
}
