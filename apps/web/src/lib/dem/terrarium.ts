// AWS Terrain Tiles (Mapzen Joerd) loader for the SENTRY 3D scene.
//
// Source: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// Reference: https://github.com/tilezen/joerd/blob/master/docs/use-service.md
//
// The "terrarium" PNG format encodes elevation in metres into the RGB channels:
//   elevation_m = (R * 256 + G + B / 256) - 32768
//
// Each tile is 256×256 px and covers a Web-Mercator quadkey at zoom z. We
// pick a sensible zoom (10–12) for a ~5 km SENTRY scene and stitch up to
// 4 tiles to cover the requested bbox. Decoding happens by drawing each
// PNG to an offscreen <canvas> and reading getImageData() pixels.
//
// Caching: results are persisted in localStorage keyed on bbox+zoom so the
// dispatcher's refresh isn't slow. We store only the Float32Array buffer
// as a base64 string — the raw heights compress well over typical 5 km
// scenes (most cells share a few hundred metres of elevation).
//
// Failure handling: any network/decode error rejects the promise. Callers
// (the React hook layer) handle the fallback to the procedural heightmap.

import type { Bbox } from "../geo/bbox";
import { bboxKey } from "../geo/bbox";

export interface DemTile {
  /** Row-major elevations in metres. Length = dims[0] * dims[1]. */
  heights: Float32Array;
  /** [rows, cols] of the stitched grid. */
  dims: [number, number];
  bounds: Bbox;
  zoom: number;
}

const TERRARIUM_OFFSET = 32768;
const TILE_SIZE = 256;
const FETCH_TIMEOUT_MS = 4000;
const CACHE_PREFIX = "sentry:dem:terrarium:";
const CACHE_VERSION = "v1";

// ─────────────── Pure decoder (unit-tested) ───────────────

/**
 * Decode the Mapzen "terrarium" RGB encoding into elevation metres.
 *
 *   elevation_m = (R * 256 + G + B / 256) - 32768
 *
 * Inputs come in as ints in [0, 255]. Returns metres above sea level
 * (negative values mean below sea level).
 */
export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - TERRARIUM_OFFSET;
}

/**
 * Decode an RGBA pixel array (length 4 × N) into a Float32Array of
 * elevations in metres (length N). Alpha channel is ignored.
 */
export function decodeTerrariumPixels(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  if (rgba.length % 4 !== 0) {
    throw new Error("decodeTerrariumPixels: input length must be a multiple of 4");
  }
  const n = rgba.length / 4;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    out[i] = decodeTerrariumPixel(r, g, b);
  }
  return out;
}

// ─────────────── Web-Mercator tile math ───────────────

function lonToTileX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const latRad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
}

interface TileRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

function tileRangeForBbox(bbox: Bbox, zoom: number): TileRange {
  const xMin = Math.floor(lonToTileX(bbox.west, zoom));
  const xMax = Math.floor(lonToTileX(bbox.east, zoom));
  const yMin = Math.floor(latToTileY(bbox.north, zoom));
  const yMax = Math.floor(latToTileY(bbox.south, zoom));
  return { xMin, xMax, yMin, yMax };
}

/**
 * Pick a zoom level that yields between 1 and 4 tiles for the bbox.
 * For a SENTRY 5 km scene this lands at z=11 or z=12. Larger bboxes
 * fall back to z=10 to stay inside the 4-tile budget.
 */
export function pickZoom(bbox: Bbox, preferred: number = 12): number {
  for (let z = preferred; z >= 8; z--) {
    const r = tileRangeForBbox(bbox, z);
    const tiles = (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
    if (tiles <= 4) return z;
  }
  return 8;
}

// ─────────────── Network + image decode ───────────────

function tileUrl(z: number, x: number, y: number): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal, mode: "cors" }).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Fetch one tile and return its decoded RGBA pixel buffer (length 256×256×4).
 * Browser-only — uses createImageBitmap + OffscreenCanvas.
 */
async function fetchTilePixels(
  z: number,
  x: number,
  y: number,
): Promise<Uint8ClampedArray> {
  const res = await fetchWithTimeout(tileUrl(z, x, y), FETCH_TIMEOUT_MS);
  if (!res.ok) {
    throw new Error(`terrarium tile ${z}/${x}/${y} HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  // Prefer OffscreenCanvas where supported; fall back to a detached <canvas>.
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  let imageData: ImageData;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("OffscreenCanvas 2d ctx unavailable");
    ctx.drawImage(bitmap, 0, 0);
    imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  } else {
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d ctx unavailable");
    ctx.drawImage(bitmap, 0, 0);
    imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  }
  bitmap.close();
  return imageData.data;
}

// ─────────────── Cache (localStorage) ───────────────

interface CachedDem {
  v: string;
  zoom: number;
  rows: number;
  cols: number;
  bounds: Bbox;
  /** Float32Array bytes, base64-encoded. */
  data: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa is browser-only but this whole module is browser-only.
  return typeof btoa === "function" ? btoa(bin) : "";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = typeof atob === "function" ? atob(b64) : "";
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readCache(key: string): DemTile | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDem;
    if (parsed.v !== CACHE_VERSION) return null;
    const bytes = base64ToBytes(parsed.data);
    const heights = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
    );
    // Copy into a fresh buffer so the underlying ArrayBuffer isn't shared.
    return {
      heights: new Float32Array(heights),
      dims: [parsed.rows, parsed.cols],
      bounds: parsed.bounds,
      zoom: parsed.zoom,
    };
  } catch {
    return null;
  }
}

function writeCache(key: string, dem: DemTile): void {
  try {
    if (typeof localStorage === "undefined") return;
    const bytes = new Uint8Array(
      dem.heights.buffer,
      dem.heights.byteOffset,
      dem.heights.byteLength,
    );
    const payload: CachedDem = {
      v: CACHE_VERSION,
      zoom: dem.zoom,
      rows: dem.dims[0],
      cols: dem.dims[1],
      bounds: dem.bounds,
      data: bytesToBase64(bytes),
    };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
  } catch {
    /* localStorage full or disabled — ignore, no caching. */
  }
}

// ─────────────── Public API: loadTerrarium ───────────────

/**
 * Fetch + decode a stitched DEM raster covering the given bbox.
 *
 * - Picks z=10–12 based on bbox size (≤4 tiles).
 * - Stitches tiles row-major into a Float32Array of elevations (metres).
 * - Caches results in localStorage so a refresh is instant.
 * - Throws on any tile fetch/decode failure (caller handles fallback).
 */
export async function loadTerrarium(
  bbox: Bbox,
  zoom?: number,
): Promise<DemTile> {
  const z = zoom ?? pickZoom(bbox, 12);
  const key = bboxKey(bbox, z);
  const cached = readCache(key);
  if (cached) return cached;

  const range = tileRangeForBbox(bbox, z);
  const tiles: { x: number; y: number; pixels: Uint8ClampedArray }[] = [];
  const fetchJobs: Promise<void>[] = [];
  for (let y = range.yMin; y <= range.yMax; y++) {
    for (let x = range.xMin; x <= range.xMax; x++) {
      const xx = x;
      const yy = y;
      fetchJobs.push(
        fetchTilePixels(z, xx, yy).then((pixels) => {
          tiles.push({ x: xx, y: yy, pixels });
        }),
      );
    }
  }
  await Promise.all(fetchJobs);

  const cols = (range.xMax - range.xMin + 1) * TILE_SIZE;
  const rows = (range.yMax - range.yMin + 1) * TILE_SIZE;
  const heights = new Float32Array(rows * cols);
  for (const t of tiles) {
    const decoded = decodeTerrariumPixels(t.pixels);
    const tileRow0 = (t.y - range.yMin) * TILE_SIZE;
    const tileCol0 = (t.x - range.xMin) * TILE_SIZE;
    for (let py = 0; py < TILE_SIZE; py++) {
      const dst = (tileRow0 + py) * cols + tileCol0;
      const src = py * TILE_SIZE;
      heights.set(decoded.subarray(src, src + TILE_SIZE), dst);
    }
  }

  // Stitched bounds match the tile boundaries (slightly larger than the
  // requested bbox). The CA / 3D layer can clip itself with bilinear sample.
  const tileBoundsWest = (range.xMin / Math.pow(2, z)) * 360 - 180;
  const tileBoundsEast = ((range.xMax + 1) / Math.pow(2, z)) * 360 - 180;
  const tileBoundsNorthRad = Math.atan(
    Math.sinh(Math.PI * (1 - (2 * range.yMin) / Math.pow(2, z))),
  );
  const tileBoundsSouthRad = Math.atan(
    Math.sinh(Math.PI * (1 - (2 * (range.yMax + 1)) / Math.pow(2, z))),
  );
  const bounds: Bbox = {
    west: tileBoundsWest,
    east: tileBoundsEast,
    north: (tileBoundsNorthRad * 180) / Math.PI,
    south: (tileBoundsSouthRad * 180) / Math.PI,
  };

  const dem: DemTile = { heights, dims: [rows, cols], bounds, zoom: z };
  writeCache(key, dem);
  return dem;
}

/**
 * Bilinear-sample the DEM at a (lat, lon). Returns metres. Out-of-range
 * samples are clamped to the nearest edge.
 */
export function sampleDem(dem: DemTile, lat: number, lon: number): number {
  const { bounds } = dem;
  const [rows, cols] = dem.dims;
  const fx = (lon - bounds.west) / (bounds.east - bounds.west);
  const fy = (bounds.north - lat) / (bounds.north - bounds.south);
  const x = Math.max(0, Math.min(cols - 1, fx * (cols - 1)));
  const y = Math.max(0, Math.min(rows - 1, fy * (rows - 1)));
  const x0 = Math.floor(x);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(rows - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const h00 = dem.heights[y0 * cols + x0]!;
  const h10 = dem.heights[y0 * cols + x1]!;
  const h01 = dem.heights[y1 * cols + x0]!;
  const h11 = dem.heights[y1 * cols + x1]!;
  return (
    h00 * (1 - dx) * (1 - dy) +
    h10 * dx * (1 - dy) +
    h01 * (1 - dx) * dy +
    h11 * dx * dy
  );
}

/**
 * Resample the DEM into an N×N normalized heightmap suitable for the
 * Three.js terrain. Output is in [-vScale, +vScale] world units (metres
 * mapped to scene units via the simulator's vertical scale).
 */
export function resampleDem(
  dem: DemTile,
  bbox: Bbox,
  resolution: number,
  vScale: number = 1,
): Float32Array {
  if (resolution <= 0 || !Number.isFinite(resolution)) {
    throw new Error("resampleDem: resolution must be a positive integer");
  }
  // First pass: collect raw metres + min/max for normalization.
  const raw = new Float32Array(resolution * resolution);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < resolution; j++) {
    const fy = j / (resolution - 1);
    const lat = bbox.north - fy * (bbox.north - bbox.south);
    for (let i = 0; i < resolution; i++) {
      const fx = i / (resolution - 1);
      const lon = bbox.west + fx * (bbox.east - bbox.west);
      const h = sampleDem(dem, lat, lon);
      raw[j * resolution + i] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  // Second pass: rescale to [-vScale, +vScale] centered on the mean. We
  // avoid a flat-zero output if min === max (e.g., over a flat ocean).
  const out = new Float32Array(resolution * resolution);
  const range = maxH - minH;
  if (range < 1e-3) {
    return out; // all zeros — flat
  }
  const mid = (minH + maxH) / 2;
  for (let i = 0; i < raw.length; i++) {
    out[i] = ((raw[i]! - mid) / (range / 2)) * vScale;
  }
  return out;
}
