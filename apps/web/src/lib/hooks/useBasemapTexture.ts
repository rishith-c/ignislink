"use client";

// React Query hook that loads + stitches an ESRI World Topo Map tile mosaic
// covering a bbox, builds a THREE.CanvasTexture, and returns it ready to
// drop on a meshStandardMaterial.map.
//
// Caching: TanStack Query handles in-memory + stale-while-revalidate.
// Additionally, the stitched canvas is persisted to localStorage as a data
// URL keyed on bbox+zoom so a refresh hydrates instantly while a fresh
// fetch runs in the background. Entries above ~1.5 MB are skipped.
//
// Failure mode: returns `texture: null`. The Terrain layer falls back to
// the dark `#1a1a1a` mesh when no texture is provided.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as THREE from "three";

import type { FirmsBbox } from "@/lib/firms/client";
import { bboxKey } from "@/lib/geo/bbox";
import { pickBasemapZoom, stitchBasemap } from "@/lib/basemap/esri-topo";

export interface UseBasemapTextureOptions {
  bbox?: FirmsBbox | null;
  enabled?: boolean;
  /** Final texture size in pixels (square). Default 1024. */
  canvasSize?: number;
}

export interface UseBasemapTextureResult {
  texture: THREE.CanvasTexture | null;
  loading: boolean;
  error?: Error;
}

const CACHE_PREFIX = "sentry:basemap:esri:";
const CACHE_VERSION = "v1";
const CACHE_MAX_BYTES = 1_500_000;
const STALE_TIME_MS = 24 * 60 * 60 * 1000;

interface CachedEntry {
  v: string;
  dataUrl: string;
}

function readCache(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (parsed.v !== CACHE_VERSION) return null;
    return parsed.dataUrl;
  } catch {
    return null;
  }
}

function writeCache(key: string, dataUrl: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (dataUrl.length > CACHE_MAX_BYTES) return;
    const payload: CachedEntry = { v: CACHE_VERSION, dataUrl };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
  } catch (err) {
    // Quota exceeded or storage disabled — skip silently.
    console.warn("[basemap] localStorage write failed:", err);
  }
}

/**
 * Build a THREE.CanvasTexture from an HTMLCanvasElement, with mipmaps,
 * anisotropic filtering, and sRGB color space configured for crisp
 * rendering at all zoom levels.
 */
function canvasToTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Load a data-URL into a fresh canvas synchronously enough that we can
 * hand it to a CanvasTexture. Returns null on failure.
 */
function dataUrlToCanvas(dataUrl: string, size: number): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = (): void => {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, size, size);
      resolve(c);
    };
    img.onerror = (): void => resolve(null);
    img.src = dataUrl;
  });
}

export function useBasemapTexture(
  options: UseBasemapTextureOptions,
): UseBasemapTextureResult {
  const { bbox, enabled = true, canvasSize = 1024 } = options;
  const zoom = bbox ? pickBasemapZoom(bbox) : 0;
  const key = bbox ? bboxKey(bbox, zoom) : "no-bbox";

  // Hydrate the cached texture instantly on mount so the user sees the
  // map immediately. The TanStack Query refetch then refreshes it in the
  // background.
  const [cachedTexture, setCachedTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!bbox) {
      setCachedTexture(null);
      return;
    }
    let disposed = false;
    let createdTexture: THREE.CanvasTexture | null = null;
    const cached = readCache(key);
    if (cached) {
      void dataUrlToCanvas(cached, canvasSize).then((canvas) => {
        if (disposed || !canvas) return;
        createdTexture = canvasToTexture(canvas);
        setCachedTexture(createdTexture);
      });
    } else {
      setCachedTexture(null);
    }
    return (): void => {
      disposed = true;
      if (createdTexture) createdTexture.dispose();
    };
  }, [bbox, key, canvasSize]);

  const query = useQuery<HTMLCanvasElement, Error>({
    queryKey: ["basemap", "esri-topo", key, canvasSize],
    enabled: Boolean(enabled && bbox),
    staleTime: STALE_TIME_MS,
    gcTime: STALE_TIME_MS,
    retry: 0,
    queryFn: async ({ signal }) => {
      if (!bbox) throw new Error("no bbox");
      const canvas = await stitchBasemap(bbox, { canvasSize, signal });
      // Persist cache (best-effort; never throws).
      try {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        writeCache(key, dataUrl);
      } catch (err) {
        console.warn("[basemap] cache encode failed:", err);
      }
      return canvas;
    },
  });

  // Promote the freshly-fetched canvas into a CanvasTexture. We memoise
  // by canvas identity so the texture is only re-created when the data
  // actually changes.
  const freshTexture = useMemo<THREE.CanvasTexture | null>(() => {
    if (!query.data) return null;
    return canvasToTexture(query.data);
  }, [query.data]);

  // Dispose superseded textures so we don't leak GPU memory.
  useEffect(() => {
    return (): void => {
      if (freshTexture) freshTexture.dispose();
    };
  }, [freshTexture]);

  if (query.error) {
    console.warn("[basemap] fetch failed:", query.error.message);
  }

  // Prefer the freshly fetched texture; fall back to the cached one while
  // the fetch is in flight; finally null.
  const texture = freshTexture ?? cachedTexture ?? null;

  return {
    texture,
    loading: query.isLoading && !cachedTexture,
    error: query.error ?? undefined,
  };
}
