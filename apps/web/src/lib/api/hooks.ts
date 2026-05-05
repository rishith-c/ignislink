"use client";

// TanStack Query hooks for the FastAPI backend. Each hook falls back to a
// fixture from @/lib/fixtures when the request errors so the dispatcher
// console keeps rendering even with the backend down — non-negotiable for
// the demo path.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  getDetections,
  getEarthquakes,
  getFloodGauges,
  isOk,
  type BBox,
  type Detection,
  type DetectionsResponse,
  type EarthquakeFeatureCollection,
  type FloodGaugeListing,
} from "./client";
import { FIXTURE_INCIDENTS, type FixtureIncident } from "@/lib/fixtures";

const LIVE_REFETCH_MS = 30_000;

export type DetectionsHookData = {
  incidents: Detection[] | FixtureIncident[];
  source: "backend" | "fixture";
};

/**
 * useDetections — pulls live detections from the backend; falls back to
 * fixtures when the call errors. Polls every 30s while a tab is focused.
 */
export function useDetections(args?: { bbox?: BBox }): UseQueryResult<DetectionsHookData> {
  return useQuery<DetectionsHookData>({
    queryKey: ["detections", args?.bbox ?? null],
    refetchInterval: LIVE_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    queryFn: async (): Promise<DetectionsHookData> => {
      const result = await getDetections({ bbox: args?.bbox });
      if (isOk(result)) {
        const payload = result.data as DetectionsResponse & { incidents?: Detection[] };
        const incidents = Array.isArray(payload.incidents) ? payload.incidents : [];
        if (incidents.length > 0) return { incidents, source: "backend" };
      }
      // Backend down or empty — fall back to fixtures so the UI still shows
      // something credible. Do not throw, the consumer expects data.
      return { incidents: FIXTURE_INCIDENTS, source: "fixture" };
    },
    // Always keep returning the previous data when refetching so the UI
    // doesn't flicker between live and fallback.
    placeholderData: (prev) => prev,
  });
}

export interface PredictionRequestArgs {
  detection_id: string;
  // Optional override; when omitted the hook is disabled.
  enabled?: boolean;
}

export function usePrediction(detectionId: string | null) {
  return useQuery({
    queryKey: ["prediction", detectionId],
    enabled: Boolean(detectionId),
    refetchInterval: LIVE_REFETCH_MS,
    queryFn: async () => {
      if (!detectionId) return null;
      // Predictions are POSTed; we don't have full request context here, so
      // hooks consumers POST themselves via the client. This hook is a
      // placeholder for read-only prediction lookups when Agent 2 exposes
      // GET /predictions/{detection_id} (not in current scope).
      return null;
    },
  });
}

export type EarthquakesHookData = {
  data: EarthquakeFeatureCollection | null;
  source: "backend" | "fallback";
};

export function useEarthquakes(args?: { bbox?: BBox; since?: string }): UseQueryResult<EarthquakesHookData> {
  return useQuery<EarthquakesHookData>({
    queryKey: ["earthquakes", args?.bbox ?? null, args?.since ?? null],
    refetchInterval: LIVE_REFETCH_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await getEarthquakes(args);
      if (isOk(result)) return { data: result.data, source: "backend" };
      // Earthquakes don't have a fixture file; the EarthquakeMap component
      // already falls back to USGS direct-fetch in that case, so we just
      // return null and let the caller decide.
      return { data: null, source: "fallback" };
    },
  });
}

export type FloodGaugesHookData = {
  data: FloodGaugeListing | null;
  source: "backend" | "fallback";
};

export function useFloodGauges(args?: { state?: string }): UseQueryResult<FloodGaugesHookData> {
  return useQuery<FloodGaugesHookData>({
    queryKey: ["floodGauges", args?.state ?? "ca"],
    refetchInterval: LIVE_REFETCH_MS,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await getFloodGauges(args);
      if (isOk(result)) return { data: result.data, source: "backend" };
      return { data: null, source: "fallback" };
    },
  });
}
