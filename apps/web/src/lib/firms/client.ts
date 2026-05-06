// NASA FIRMS Active Fire Data CSV client.
//
// Endpoint shape (NASA FIRMS Area API):
//   https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{west,south,east,north}/{days}
//
// When `FIRMS_API_KEY` is missing we fall back to a bundled fixture CSV
// served from `/firms-fixture.csv`. The fixture is a hand-tuned set of
// plausible El Dorado County, CA hotspots so the 3D scene has multiple
// ignition seeds even without a NASA key.

export type FirmsConfidence = "low" | "nominal" | "high";

export interface FirmsHotspot {
  latitude: number;
  longitude: number;
  brightTi4: number;
  scan: number;
  track: number;
  acqDate: string;
  acqTime: string;
  confidence: FirmsConfidence;
  frp: number;
  satellite?: string;
  instrument?: string;
  daynight?: "D" | "N";
}

export interface FirmsBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface FirmsFetchOptions {
  bbox: FirmsBbox;
  apiKey?: string;
  source?: string;
  days?: number;
  /** Override fetch implementation for tests. */
  fetchImpl?: typeof fetch;
  /** Override the path to the bundled fixture CSV. */
  fixtureUrl?: string;
  /** Pre-loaded fixture CSV body (used by tests). */
  fixtureCsv?: string;
}

export interface FirmsFetchResult {
  ok: boolean;
  hotspots: FirmsHotspot[];
  source: "live" | "fixture";
  fetchedAt: string;
  error?: string;
}

const FIRMS_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const DEFAULT_SOURCE = "VIIRS_NOAA20_NRT";
const DEFAULT_DAYS = 1;
const DEFAULT_FIXTURE_URL = "/firms-fixture.csv";

function normalizeConfidence(raw: string | undefined): FirmsConfidence {
  if (!raw) return "nominal";
  const v = raw.trim().toLowerCase();
  if (v === "h" || v === "high") return "high";
  if (v === "l" || v === "low") return "low";
  if (v === "n" || v === "nominal") return "nominal";
  // VIIRS sometimes ships numeric confidence (0–100). Bucket it.
  const n = parseFloat(v);
  if (Number.isFinite(n)) {
    if (n >= 80) return "high";
    if (n >= 30) return "nominal";
    return "low";
  }
  return "nominal";
}

function safeNumber(raw: string | undefined, fallback = 0): number {
  if (raw === undefined || raw === null) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a FIRMS Active-Fire CSV body into typed hotspots. Tolerant of
 * column-order changes and missing optional fields.
 */
export function parseFirmsCsv(csv: string): FirmsHotspot[] {
  const trimmed = csv.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = (lines[0] ?? "").split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string): number => header.indexOf(name);
  const iLat = idx("latitude");
  const iLon = idx("longitude");
  if (iLat < 0 || iLon < 0) return [];
  const iBright = idx("bright_ti4") >= 0 ? idx("bright_ti4") : idx("brightness");
  const iScan = idx("scan");
  const iTrack = idx("track");
  const iAcqDate = idx("acq_date");
  const iAcqTime = idx("acq_time");
  const iConf = idx("confidence");
  const iFrp = idx("frp");
  const iSat = idx("satellite");
  const iInstr = idx("instrument");
  const iDayNight = idx("daynight");

  const out: FirmsHotspot[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");
    const lat = safeNumber(parts[iLat], NaN);
    const lon = safeNumber(parts[iLon], NaN);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      latitude: lat,
      longitude: lon,
      brightTi4: iBright >= 0 ? safeNumber(parts[iBright]) : 0,
      scan: iScan >= 0 ? safeNumber(parts[iScan]) : 0,
      track: iTrack >= 0 ? safeNumber(parts[iTrack]) : 0,
      acqDate: iAcqDate >= 0 ? (parts[iAcqDate] ?? "") : "",
      acqTime: iAcqTime >= 0 ? (parts[iAcqTime] ?? "") : "",
      confidence: normalizeConfidence(iConf >= 0 ? parts[iConf] : undefined),
      frp: iFrp >= 0 ? safeNumber(parts[iFrp]) : 0,
      satellite: iSat >= 0 ? parts[iSat] : undefined,
      instrument: iInstr >= 0 ? parts[iInstr] : undefined,
      daynight:
        iDayNight >= 0
          ? ((parts[iDayNight] ?? "").trim().toUpperCase() === "N" ? "N" : "D")
          : undefined,
    });
  }
  return out;
}

function buildFirmsUrl(opts: {
  apiKey: string;
  source: string;
  bbox: FirmsBbox;
  days: number;
}): string {
  const { apiKey, source, bbox, days } = opts;
  const parts = [bbox.west, bbox.south, bbox.east, bbox.north]
    .map((n) => n.toFixed(4))
    .join(",");
  return `${FIRMS_BASE}/${apiKey}/${source}/${parts}/${days}`;
}

/**
 * Fetch FIRMS hotspots within a bbox. Falls back to a bundled fixture CSV
 * when no API key is configured (or when the live request fails).
 */
export async function fetchFirmsHotspots(
  opts: FirmsFetchOptions,
): Promise<FirmsFetchResult> {
  const fetchedAt = new Date().toISOString();
  const apiKey = opts.apiKey ?? readApiKeyFromEnv();
  const source = opts.source ?? DEFAULT_SOURCE;
  const days = opts.days ?? DEFAULT_DAYS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  if (!apiKey) {
    return loadFixture(opts, fetchedAt, "FIRMS_API_KEY not configured");
  }

  if (!fetchImpl) {
    return loadFixture(opts, fetchedAt, "fetch unavailable");
  }

  try {
    const url = buildFirmsUrl({ apiKey, source, bbox: opts.bbox, days });
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "sentry-max/0.1 (ops@sentry-max.io)" },
      cache: "no-store",
    });
    if (!res.ok) {
      return loadFixture(opts, fetchedAt, `FIRMS HTTP ${res.status}`);
    }
    const csv = await res.text();
    const hotspots = parseFirmsCsv(csv);
    return { ok: true, hotspots, source: "live", fetchedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return loadFixture(opts, fetchedAt, message);
  }
}

async function loadFixture(
  opts: FirmsFetchOptions,
  fetchedAt: string,
  reason: string,
): Promise<FirmsFetchResult> {
  if (typeof opts.fixtureCsv === "string") {
    return {
      ok: true,
      hotspots: parseFirmsCsv(opts.fixtureCsv),
      source: "fixture",
      fetchedAt,
      error: reason,
    };
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const fixtureUrl = opts.fixtureUrl ?? DEFAULT_FIXTURE_URL;
  if (!fetchImpl) {
    return {
      ok: false,
      hotspots: [],
      source: "fixture",
      fetchedAt,
      error: `${reason}; no fetch impl available for fixture`,
    };
  }
  try {
    const res = await fetchImpl(fixtureUrl, { cache: "no-store" });
    if (!res.ok) {
      return {
        ok: false,
        hotspots: [],
        source: "fixture",
        fetchedAt,
        error: `${reason}; fixture HTTP ${res.status}`,
      };
    }
    const csv = await res.text();
    return {
      ok: true,
      hotspots: parseFirmsCsv(csv),
      source: "fixture",
      fetchedAt,
      error: reason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      hotspots: [],
      source: "fixture",
      fetchedAt,
      error: `${reason}; fixture load failed: ${message}`,
    };
  }
}

function readApiKeyFromEnv(): string {
  // We deliberately read both server- and client-visible names. On the
  // browser only the NEXT_PUBLIC_* form is defined; on the server either
  // name works.
  const fromServer =
    typeof process !== "undefined" && process.env ? process.env.FIRMS_API_KEY : undefined;
  const fromClient =
    typeof process !== "undefined" && process.env
      ? process.env.NEXT_PUBLIC_FIRMS_API_KEY
      : undefined;
  return (fromServer ?? fromClient ?? "").trim();
}
