"use client";

// React Query hook that loads + resamples a DEM into a Float32Array
// suitable for the Three.js terrain mesh. Falls back to `null` on any
// failure so the FireSimulator3D layer can keep its procedural heightmap.
//
// Caching: TanStack Query handles in-memory + stale-while-revalidate;
// loadTerrarium() additionally persists the raw bytes to localStorage.

import { useQuery } from "@tanstack/react-query";

import type { Bbox } from "@/lib/geo/bbox";
import { bboxKey } from "@/lib/geo/bbox";
import { loadTerrarium, resampleDem } from "@/lib/dem/terrarium";

export interface UseDemHeightmapResult {
  heightmap: Float32Array | null;
  loading: boolean;
  source: "terrarium" | "procedural" | "loading";
}

interface UseDemHeightmapOptions {
  bbox?: Bbox | null;
  resolution?: number;
  vScale?: number;
  zoom?: number;
  enabled?: boolean;
}

export function useDemHeightmap(options: UseDemHeightmapOptions): UseDemHeightmapResult {
  const { bbox, resolution = 96, vScale = 1, zoom, enabled = true } = options;
  const key = bbox ? bboxKey(bbox, zoom ?? 0) : "no-bbox";
  const query = useQuery<Float32Array, Error>({
    queryKey: ["dem", "terrarium", key, resolution, vScale],
    enabled: Boolean(enabled && bbox),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      if (!bbox) throw new Error("no bbox");
      const dem = await loadTerrarium(bbox, zoom);
      return resampleDem(dem, bbox, resolution, vScale);
    },
  });

  if (query.isLoading) {
    return { heightmap: null, loading: true, source: "loading" };
  }
  if (query.data) {
    return { heightmap: query.data, loading: false, source: "terrarium" };
  }
  return { heightmap: null, loading: false, source: "procedural" };
}
