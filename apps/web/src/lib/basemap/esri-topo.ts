// ESRI World Topo Map basemap stitcher for the SENTRY 3D scene.
//
// Source: https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}
// NOTE: ESRI uses {z}/{y}/{x} order (NOT /{z}/{x}/{y} like OSM).
// The service is free, requires no API key, and ships CORS headers so the
// resulting <canvas> isn't tainted (i.e. we can read its pixels and feed it
// into a THREE.CanvasTexture).
//
// stitchBasemap(bbox, opts) downloads the tiles covering `bbox`, blits them
// into one offscreen canvas, crops to the exact bbox edges, and rescales to
// `canvasSize`×`canvasSize`. Returns the final HTMLCanvasElement.
//
// Failure mode: any tile fetch/decode failure rejects. The caller (the
// React-Query hook) is responsible for falling back to the dark terrain.

import type { FirmsBbox } from "../firms/client";

const TILE_SIZE = 256;
const DEFAULT_CANVAS_SIZE = 1024;
const ATTRIBUTION_TEXT = "© Esri · World Topo Map";

export interface StitchOptions {
  /** Final square texture size in pixels. Defaults to 1024. */
  canvasSize?: number;
  /** Forwarded to the AbortController for cancelling pending Image() loads. */
  signal?: AbortSignal;
  /** Override the upstream tile URL template (used by tests). */
  tileUrl?: (z: number, x: number, y: number) => string;
}

// ─────────────── Tile-coordinate math ───────────────

export function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

export function lat2tile(lat: number, z: number): number {
  const n = Math.pow(2, z);
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
      n,
  );
}

/** Inverse: tile X (fractional) → longitude. */
function tile2lon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

/** Inverse: tile Y (fractional) → latitude. */
function tile2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/**
 * Pick a zoom level that keeps the tile grid covering the bbox between
 * 4×4 and 8×8 tiles. Smaller bboxes pick a higher zoom (more detail);
 * larger bboxes pick a lower zoom (fewer tiles).
 */
export function pickBasemapZoom(bbox: FirmsBbox): number {
  const span = Math.max(0.0001, bbox.east - bbox.west);
  const heuristic = Math.round(Math.log2(360 / span)) + 2;
  // Clamp so we never run away with tile counts.
  const z = Math.max(8, Math.min(14, heuristic));
  // For very small bboxes (< 0.01° ≈ 1 km) bias toward max zoom.
  if (span < 0.01) return 14;
  return z;
}

interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function tileRange(bbox: FirmsBbox, z: number): TileRange {
  const xMin = lon2tile(bbox.west, z);
  const xMax = lon2tile(bbox.east, z);
  const yMin = lat2tile(bbox.north, z);
  const yMax = lat2tile(bbox.south, z);
  return { xMin, xMax, yMin, yMax };
}

// ─────────────── Image loading ───────────────

function defaultTileUrl(z: number, x: number, y: number): string {
  // ESRI World Topo Map: NOTE the {z}/{y}/{x} ordering.
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`;
}

/**
 * Load a single tile as an HTMLImageElement. Honours an AbortSignal by
 * clearing img.src on abort, which cancels the in-flight request in all
 * modern browsers.
 */
function loadTileImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    const onAbort = (): void => {
      img.src = "";
      reject(new DOMException("aborted", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    img.onload = (): void => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(img);
    };
    img.onerror = (): void => {
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(new Error(`tile load failed: ${url}`));
    };
    img.src = url;
  });
}

// ─────────────── Attribution overlay ───────────────

function paintAttribution(ctx: CanvasRenderingContext2D, canvasSize: number): void {
  const padding = 6;
  const fontSize = 10;
  ctx.save();
  ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(ATTRIBUTION_TEXT);
  const textWidth = metrics.width;
  const boxHeight = fontSize + padding * 1.2;
  const boxWidth = textWidth + padding * 2;
  // Bottom-left corner.
  const x = padding;
  const y = canvasSize - boxHeight - padding;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.textBaseline = "middle";
  ctx.fillText(ATTRIBUTION_TEXT, x + padding, y + boxHeight / 2);
  ctx.restore();
}

// ─────────────── Public API ───────────────

/**
 * Fetch and stitch an ESRI World Topo Map mosaic covering the bbox.
 *
 * Algorithm:
 *   1. Pick a zoom level (4×4 to 8×8 tiles).
 *   2. Compute the tile range covering the bbox.
 *   3. Fetch every tile in parallel.
 *   4. Blit them into one offscreen canvas (tilesPerRow*256 wide).
 *   5. Crop to the exact bbox edges using fractional tile coords.
 *   6. Rescale that crop onto a `canvasSize`×`canvasSize` final canvas.
 *   7. Paint a small attribution box.
 *
 * Bbox crossing the antimeridian (west > east) is rejected.
 */
export async function stitchBasemap(
  bbox: FirmsBbox,
  opts: StitchOptions = {},
): Promise<HTMLCanvasElement> {
  if (bbox.west >= bbox.east || bbox.south >= bbox.north) {
    throw new Error("stitchBasemap: degenerate or antimeridian-crossing bbox");
  }
  const canvasSize = opts.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const tileUrl = opts.tileUrl ?? defaultTileUrl;
  const signal = opts.signal;

  const zoom = pickBasemapZoom(bbox);
  const range = tileRange(bbox, zoom);
  const tilesX = range.xMax - range.xMin + 1;
  const tilesY = range.yMax - range.yMin + 1;

  // Build the tile mosaic canvas.
  const mosaicWidth = tilesX * TILE_SIZE;
  const mosaicHeight = tilesY * TILE_SIZE;
  const mosaic = document.createElement("canvas");
  mosaic.width = mosaicWidth;
  mosaic.height = mosaicHeight;
  const mosaicCtx = mosaic.getContext("2d");
  if (!mosaicCtx) {
    throw new Error("stitchBasemap: 2d context unavailable");
  }

  // Fetch all tiles in parallel.
  const jobs: Promise<{ x: number; y: number; img: HTMLImageElement }>[] = [];
  for (let y = range.yMin; y <= range.yMax; y++) {
    for (let x = range.xMin; x <= range.xMax; x++) {
      const xx = x;
      const yy = y;
      jobs.push(
        loadTileImage(tileUrl(zoom, xx, yy), signal).then((img) => ({ x: xx, y: yy, img })),
      );
    }
  }
  const loaded = await Promise.all(jobs);

  for (const tile of loaded) {
    const tx = (tile.x - range.xMin) * TILE_SIZE;
    const ty = (tile.y - range.yMin) * TILE_SIZE;
    mosaicCtx.drawImage(tile.img, tx, ty);
  }

  // Compute the pixel rect inside the mosaic that corresponds exactly to
  // the requested bbox. We use fractional tile coords for sub-pixel
  // accuracy — the final rescale absorbs any rounding noise.
  const fxWest = ((bbox.west + 180) / 360) * Math.pow(2, zoom);
  const fxEast = ((bbox.east + 180) / 360) * Math.pow(2, zoom);
  const fyNorth = lat2tileFractional(bbox.north, zoom);
  const fySouth = lat2tileFractional(bbox.south, zoom);
  const cropX = (fxWest - range.xMin) * TILE_SIZE;
  const cropY = (fyNorth - range.yMin) * TILE_SIZE;
  const cropW = (fxEast - fxWest) * TILE_SIZE;
  const cropH = (fySouth - fyNorth) * TILE_SIZE;

  // Final canvas — square, supplied size, rescaled crop.
  const final = document.createElement("canvas");
  final.width = canvasSize;
  final.height = canvasSize;
  const finalCtx = final.getContext("2d");
  if (!finalCtx) {
    throw new Error("stitchBasemap: final 2d context unavailable");
  }
  finalCtx.imageSmoothingEnabled = true;
  finalCtx.imageSmoothingQuality = "high";
  finalCtx.drawImage(
    mosaic,
    cropX,
    cropY,
    cropW,
    cropH,
    0,
    0,
    canvasSize,
    canvasSize,
  );

  paintAttribution(finalCtx, canvasSize);

  // Free the intermediate mosaic — the cropped pixels are now in `final`.
  mosaic.width = 0;
  mosaic.height = 0;

  // tile2lon / tile2lat is exposed for callers/tests but isn't needed here.
  void tile2lon;
  void tile2lat;

  return final;
}

/** Fractional version of lat2tile (no Math.floor). */
function lat2tileFractional(lat: number, z: number): number {
  const n = Math.pow(2, z);
  return (
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
      2) *
    n
  );
}
