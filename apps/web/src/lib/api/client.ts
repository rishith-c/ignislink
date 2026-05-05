// Typed fetch wrappers for the FastAPI backend Agent 2 is exposing.
//
// Design notes:
// - Configurable base URL via NEXT_PUBLIC_API_BASE_URL, defaulting to
//   http://localhost:8000 so a local docker-compose works out of the box.
// - Each call returns ApiResult<T> = {data: T} | {error: string, fallback?: T}
//   so the caller can decide whether to use a fixture fallback.
// - Single retry on network failure; no retry on 4xx (those are real
//   errors from the backend, retrying won't help).
// - 5 second timeout per request — the dispatcher console can't afford to
//   stall on a wedged backend.

export type ApiOk<T> = { data: T };
export type ApiErr<T> = { error: string; fallback?: T };
export type ApiResult<T> = ApiOk<T> | ApiErr<T>;

export function isOk<T>(result: ApiResult<T>): result is ApiOk<T> {
  return "data" in result;
}

export function isErr<T>(result: ApiResult<T>): result is ApiErr<T> {
  return "error" in result;
}

export const DEFAULT_BASE_URL = "http://localhost:8000";

export function getApiBaseUrl(): string {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  return DEFAULT_BASE_URL;
}

const DEFAULT_TIMEOUT_MS = 5000;

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  // Allow callers (and tests) to inject a base URL without touching env.
  baseUrl?: string;
}

async function rawRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const baseUrl = options.baseUrl ?? getApiBaseUrl();
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose caller-provided signal with our timeout signal.
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: options.body
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}${text ? ` — ${text.slice(0, 160)}` : ""}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * Wrap a request with one retry on network failure (no retry on HTTP 4xx/5xx
 * — only retry when the request itself failed, which usually means the
 * backend isn't reachable yet).
 */
async function requestWithRetry<T>(path: string, options: RequestOptions): Promise<ApiResult<T>> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await rawRequest<T>(path, options);
      return { data };
    } catch (error: unknown) {
      lastError = error;
      // Only retry once, and only when the error looks like a network failure
      // (TypeError from fetch) or an abort. HTTP errors bubble through both
      // attempts but won't recover.
      const message = error instanceof Error ? error.message : String(error);
      const isNetwork =
        error instanceof TypeError ||
        message.includes("fetch failed") ||
        message.includes("Failed to fetch") ||
        message.includes("aborted");
      if (attempt === 0 && isNetwork) continue;
      break;
    }
  }
  return { error: lastError instanceof Error ? lastError.message : "Unknown error" };
}

// ──────────────────────────── Domain types ─────────────────────────────────

export interface BBox {
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
}

function bboxParam(bbox?: BBox): string {
  if (!bbox) return "";
  return `?bbox=${bbox.lon0},${bbox.lat0},${bbox.lon1},${bbox.lat1}`;
}

// Detection / incident shape — matches the IncidentInternalEvent contract
// loosely. The backend may emit a richer envelope; we keep the type permissive
// here (Record<string, unknown>) so we don't tightly couple the UI to a
// schema that's still evolving on Agent 2's side.
export type Detection = Record<string, unknown> & {
  id?: string;
  incident_id?: string;
};

export interface DetectionsResponse {
  incidents: Detection[];
  provenance?: Record<string, unknown>;
}

export interface PredictSpreadRequest {
  detection_id: string;
  hotspot: { type: "Point"; coordinates: [number, number] };
  context_raster_key?: string;
  wind_summary?: {
    u_ms: number;
    v_ms: number;
    gust_ms: number;
    sample_at: string;
  };
  horizons_min?: number[];
}

export type PredictSpreadResponse = Record<string, unknown>;

export interface DispatchResult {
  detection_id: string;
  status: string;
  eta_minutes?: number;
  station_id?: string;
  message?: string;
}

export type EarthquakeFeatureCollection = {
  type: "FeatureCollection";
  features: Array<Record<string, unknown>>;
};

export type FloodGaugeListing = {
  gauges: Array<Record<string, unknown>>;
};

// ──────────────────────────── Public API ───────────────────────────────────

export async function getDetections(
  args?: { bbox?: BBox; baseUrl?: string; signal?: AbortSignal },
): Promise<ApiResult<DetectionsResponse>> {
  return requestWithRetry<DetectionsResponse>(`/detections${bboxParam(args?.bbox)}`, {
    method: "GET",
    baseUrl: args?.baseUrl,
    signal: args?.signal,
  });
}

export async function postPredictSpread(
  body: PredictSpreadRequest,
  args?: { baseUrl?: string; signal?: AbortSignal },
): Promise<ApiResult<PredictSpreadResponse>> {
  return requestWithRetry<PredictSpreadResponse>(`/predict/spread`, {
    method: "POST",
    body,
    baseUrl: args?.baseUrl,
    signal: args?.signal,
  });
}

export async function postDispatch(
  detectionId: string,
  args?: { baseUrl?: string; signal?: AbortSignal },
): Promise<ApiResult<DispatchResult>> {
  return requestWithRetry<DispatchResult>(`/dispatch/${encodeURIComponent(detectionId)}`, {
    method: "POST",
    body: {},
    baseUrl: args?.baseUrl,
    signal: args?.signal,
  });
}

export async function getEarthquakes(
  args?: { bbox?: BBox; since?: string; baseUrl?: string; signal?: AbortSignal },
): Promise<ApiResult<EarthquakeFeatureCollection>> {
  const params = new URLSearchParams();
  if (args?.bbox) {
    params.set(
      "bbox",
      `${args.bbox.lon0},${args.bbox.lat0},${args.bbox.lon1},${args.bbox.lat1}`,
    );
  }
  if (args?.since) params.set("since", args.since);
  const query = params.toString();
  return requestWithRetry<EarthquakeFeatureCollection>(
    `/earthquakes${query ? `?${query}` : ""}`,
    { method: "GET", baseUrl: args?.baseUrl, signal: args?.signal },
  );
}

export async function getFloodGauges(
  args?: { state?: string; baseUrl?: string; signal?: AbortSignal },
): Promise<ApiResult<FloodGaugeListing>> {
  const params = new URLSearchParams();
  params.set("state", args?.state ?? "ca");
  return requestWithRetry<FloodGaugeListing>(`/floods/gauges?${params.toString()}`, {
    method: "GET",
    baseUrl: args?.baseUrl,
    signal: args?.signal,
  });
}
