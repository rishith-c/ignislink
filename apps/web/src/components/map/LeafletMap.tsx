"use client";

import { useEffect, useRef, useState } from "react";
import L, { type Map as LMap, type Marker as LMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type IncidentStatus =
  | "EMERGING"
  | "CREWS_ACTIVE"
  | "UNREPORTED"
  | "KNOWN_PRESCRIBED"
  | "LIKELY_INDUSTRIAL";

export interface MapStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  etaMinutes: number;
}

export interface PredictedSpread {
  horizonMin: 60 | 360 | 1440;
  areaAcres: number;
  bearingDeg: number;
}

export interface MapIncident {
  id: string;
  shortId: string;
  lat: number;
  lon: number;
  status: IncidentStatus;
  /** Wind direction degrees (meteorological "from"). 0 = wind from north. */
  windDirDeg: number;
  /** Wind speed m/s. */
  windSpeedMs: number;
  /** Fuel-class scaling factor for the spread sim. 1.0 = grass; 0.4 = mixed forest. */
  fuelFactor?: number;
  /** ML-predicted 50% probability spread per horizon. Drives the contour ellipses. */
  predictedSpread?: PredictedSpread[];
  /** Nearby fire stations for the dispatcher view. */
  stations?: MapStation[];
  selected?: boolean;
}

interface LeafletMapProps {
  incidents: MapIncident[];
  /** When true, only EMERGING + CREWS_ACTIVE are rendered. */
  publicOnly?: boolean;
  /** Initial center; if omitted, fit-to-bounds of incidents. */
  initialCenter?: [number, number];
  initialZoom?: number;
  basemap?: "streets" | "satellite" | "terrain";
  onIncidentClick?: (id: string) => void;
  className?: string;
  height?: string | number;
}

const STATUS_COLOR: Record<IncidentStatus, string> = {
  EMERGING: "#f97316",
  CREWS_ACTIVE: "#10b981",
  UNREPORTED: "#a1a1aa",
  KNOWN_PRESCRIBED: "#3b82f6",
  LIKELY_INDUSTRIAL: "#a855f7",
};

const TILE_LAYERS = {
  streets: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, USGS, USDA FSA",
    maxZoom: 18,
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data © <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
};

interface Particle {
  lat: number;
  lon: number;
  vLat: number; // deg/frame
  vLon: number; // deg/frame
  age: number;
  life: number;
  baseColor: [number, number, number];
}

export function LeafletMap({
  incidents,
  publicOnly = false,
  initialCenter,
  initialZoom = 5,
  basemap: initialBasemap = "streets",
  onIncidentClick,
  className,
  height = 540,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Map<string, LMarker>>(new Map());
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);
  const stationLayerRef = useRef<L.LayerGroup | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const incidentsRef = useRef<MapIncident[]>(incidents);
  const rafRef = useRef<number | null>(null);
  const [basemap, setBasemap] = useState(initialBasemap);
  const [showContours, setShowContours] = useState(true);
  const [showStations, setShowStations] = useState(!publicOnly);

  // Keep latest incidents available to the rAF loop without re-creating it.
  useEffect(() => {
    incidentsRef.current = incidents.filter(
      (i) => !publicOnly || i.status === "EMERGING" || i.status === "CREWS_ACTIVE",
    );
  }, [incidents, publicOnly]);

  // ─────────────── Map init (one-time) ───────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const visible = incidents.filter(
      (i) => !publicOnly || i.status === "EMERGING" || i.status === "CREWS_ACTIVE",
    );

    const map = L.map(containerRef.current, {
      preferCanvas: true,
      zoomControl: true,
      attributionControl: true,
    });

    if (initialCenter) {
      map.setView(initialCenter, initialZoom);
    } else if (visible.length === 0) {
      map.setView([39.5, -98.5], 4);
    } else if (visible.length === 1) {
      const i = visible[0]!;
      map.setView([i.lat, i.lon], 9);
    } else {
      const bounds = L.latLngBounds(visible.map((i) => [i.lat, i.lon] as [number, number]));
      map.fitBounds(bounds.pad(0.4));
    }

    const cfg = TILE_LAYERS[initialBasemap];
    const tileLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    });
    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;

    mapRef.current = map;
    const markers = markersRef.current;

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────── Basemap switch ───────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }
    const cfg = TILE_LAYERS[basemap];
    const tileLayer = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    });
    tileLayer.addTo(map);
    tileLayerRef.current = tileLayer;
  }, [basemap]);

  // ─────────────── Incident markers + spread contours + stations ───────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Lazily create overlay layer groups.
    if (!overlayLayerRef.current) overlayLayerRef.current = L.layerGroup().addTo(map);
    if (!stationLayerRef.current) stationLayerRef.current = L.layerGroup().addTo(map);

    const visible = incidents.filter(
      (i) => !publicOnly || i.status === "EMERGING" || i.status === "CREWS_ACTIVE",
    );
    const visibleIds = new Set(visible.map((i) => i.id));

    // Remove markers no longer in the set.
    for (const [id, marker] of markersRef.current) {
      if (!visibleIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Wipe + redraw spread contours and station markers each pass — they're cheap
    // (a few dozen polygons total) and keep state consistent on selection change.
    overlayLayerRef.current.clearLayers();
    stationLayerRef.current.clearLayers();

    for (const inc of visible) {
      const color = STATUS_COLOR[inc.status];

      // Hotspot marker (custom divIcon)
      const ring = inc.selected ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.7)";
      const ringWidth = inc.selected ? 3 : 2;
      const radius = inc.selected ? 12 : 8;
      const animate =
        inc.status === "EMERGING" || inc.status === "UNREPORTED"
          ? "ignis-pulse 1.6s ease-in-out infinite"
          : "none";
      const html = `<div style="position:relative;width:${radius * 4}px;height:${radius * 4}px;display:flex;align-items:center;justify-content:center;pointer-events:auto;">
  <div style="position:absolute;width:${radius * 4}px;height:${radius * 4}px;border-radius:50%;background:radial-gradient(circle, ${color}66 0%, ${color}00 65%);"></div>
  <div style="position:absolute;width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:${color};border:${ringWidth}px solid ${ring};box-shadow:0 0 10px ${color}cc, 0 0 18px ${color}66;animation:${animate};"></div>
  ${inc.selected ? `<div style="position:absolute;left:${radius * 2 + 6}px;top:-2px;background:rgba(0,0,0,0.78);color:white;padding:2px 6px;border-radius:3px;font-family:ui-monospace,monospace;font-size:11px;white-space:nowrap;pointer-events:none;">${inc.shortId}</div>` : ""}
</div>`;
      const icon = L.divIcon({
        html,
        className: "ignis-marker",
        iconSize: [radius * 4, radius * 4],
        iconAnchor: [radius * 2, radius * 2],
      });

      const existing = markersRef.current.get(inc.id);
      if (existing) {
        existing.setLatLng([inc.lat, inc.lon]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([inc.lat, inc.lon], { icon, zIndexOffset: 1000 });
        if (onIncidentClick) marker.on("click", () => onIncidentClick(inc.id));
        marker.addTo(map);
        markersRef.current.set(inc.id, marker);
      }

      // ML predicted spread contours — three nested ellipses per horizon, oriented
      // along the bearing. Drawn from largest (24h, faintest) inward to (1h,
      // strongest) so the smaller ones stay visible on top.
      if (showContours && inc.predictedSpread && inc.predictedSpread.length > 0) {
        const horizonStyles: Record<
          60 | 360 | 1440,
          { stroke: string; fill: string; weight: number; dash?: string }
        > = {
          60: { stroke: color, fill: color, weight: 2 },
          360: { stroke: color, fill: color, weight: 1.5, dash: "4 4" },
          1440: { stroke: color, fill: color, weight: 1, dash: "2 6" },
        };
        const horizonAlpha: Record<60 | 360 | 1440, number> = { 60: 0.28, 360: 0.14, 1440: 0.07 };
        const sorted = [...inc.predictedSpread].sort((a, b) => b.horizonMin - a.horizonMin);
        for (const h of sorted) {
          const style = horizonStyles[h.horizonMin];
          const points = ellipseFromArea(inc.lat, inc.lon, h.areaAcres, h.bearingDeg);
          const poly = L.polygon(points, {
            color: style.stroke,
            weight: style.weight,
            opacity: 0.9,
            fillColor: style.fill,
            fillOpacity: horizonAlpha[h.horizonMin],
            dashArray: style.dash,
            interactive: false,
          });
          overlayLayerRef.current!.addLayer(poly);
        }

        // Wind-direction line emanating from the hotspot (~ to the 6 h ellipse tip).
        const six = inc.predictedSpread.find((p) => p.horizonMin === 360);
        if (six) {
          const tip = offsetByMeters(
            inc.lat,
            inc.lon,
            areaAcresToMajorRadiusM(six.areaAcres),
            six.bearingDeg,
          );
          const arrow = L.polyline([[inc.lat, inc.lon], tip], {
            color: color,
            weight: 1.5,
            opacity: 0.85,
            dashArray: "1 4",
            interactive: false,
          });
          overlayLayerRef.current!.addLayer(arrow);
        }
      }

      // Fire-station + dispatched-unit markers (pulsing dots).
      // Each station shows a pulsing dot at its base; an additional unit
      // marker animates from station → incident along the connection line
      // with the actual unit ETA driving the travel time. Color-coded so
      // the dispatcher can tell engine vs aerial vs dozer at a glance.
      if (showStations && inc.stations && inc.stations.length > 0) {
        for (const stn of inc.stations) {
          if (typeof stn.lat !== "number" || typeof stn.lon !== "number") continue;
          // Color by station-name kind hint (basic heuristic until the
          // contracts package's ResourceCandidate.kind ships through).
          const kind = /heli|h-\d/i.test(stn.name)
            ? "helicopter"
            : /tanker|t-\d|s-2|fixed/i.test(stn.name)
              ? "fixed-wing"
              : /dozer|d-\d/i.test(stn.name)
                ? "dozer"
                : /crew|hand/i.test(stn.name)
                  ? "hand-crew"
                  : "engine";
          const color =
            kind === "helicopter"
              ? "#22d3ee"
              : kind === "fixed-wing"
                ? "#a78bfa"
                : kind === "dozer"
                  ? "#fbbf24"
                  : kind === "hand-crew"
                    ? "#34d399"
                    : "#f97316";

          // Pulsing station dot (CSS keyframe in globals.css). The
          // `--pulse-color` custom property is the per-marker tint.
          const stnHtml = `<div class="sentry-pulse-dot" style="--pulse-color:${color};"></div>`;
          const stnIcon = L.divIcon({
            html: stnHtml,
            className: "ignis-station-marker",
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });
          const stnMarker = L.marker([stn.lat, stn.lon], { icon: stnIcon }).bindTooltip(
            `${stn.name} · ${kind} · ETA ${stn.etaMinutes} min`,
            { direction: "top", offset: [0, -10], opacity: 0.92 },
          );
          stationLayerRef.current!.addLayer(stnMarker);

          // Solid connection line from station to hotspot — color-tinted
          // so the path is identifiable when many stations overlap.
          const conn = L.polyline(
            [
              [stn.lat, stn.lon],
              [inc.lat, inc.lon],
            ],
            {
              color,
              weight: 1.2,
              opacity: 0.4,
              dashArray: "2 6",
              interactive: false,
            },
          );
          stationLayerRef.current!.addLayer(conn);

          // Animated dispatched-unit marker — pulses while travelling.
          const unitHtml = `<div class="sentry-pulse-dot" style="--pulse-color:${color};transform:scale(1.15);"></div>`;
          const unitIcon = L.divIcon({
            html: unitHtml,
            className: "ignis-unit-marker",
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          const unitMarker = L.marker([stn.lat, stn.lon], {
            icon: unitIcon,
            zIndexOffset: 800,
          }).bindTooltip(`${kind.toUpperCase()} en route · ETA ${stn.etaMinutes} min`, {
            direction: "top",
            offset: [0, -12],
            opacity: 0.92,
          });
          stationLayerRef.current!.addLayer(unitMarker);

          // Travel animation: ease-out so the unit slows as it nears the
          // incident. Scene-time = etaMinutes × 0.4s (so a 12 min ETA
          // crosses the screen in ~5s).
          const sceneDurationMs = Math.max(2500, stn.etaMinutes * 400);
          const startLat = stn.lat;
          const startLon = stn.lon;
          const endLat = inc.lat;
          const endLon = inc.lon;
          const t0 = performance.now();
          let raf = 0;
          const tick = () => {
            const now = performance.now();
            const t = Math.min(1, (now - t0) / sceneDurationMs);
            const eased = 1 - Math.pow(1 - t, 2.5);
            const curLat = startLat + (endLat - startLat) * eased;
            const curLon = startLon + (endLon - startLon) * eased;
            unitMarker.setLatLng([curLat, curLon]);
            if (t < 1) raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          // Ensure cleanup if the layer gets cleared mid-animation.
          unitMarker.on("remove", () => cancelAnimationFrame(raf));
        }
      }
    }
  }, [incidents, publicOnly, onIncidentClick, showContours, showStations]);

  // ─────────────── Particle simulation overlay ───────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx: CanvasRenderingContext2D = context;

    function resize() {
      const size = map!.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = size.x * dpr;
      canvas.height = size.y * dpr;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Hard-wipe the canvas (not just trail-fade) AND drop in-flight particles.
    // Required on map move/zoom because trailed pixels are positioned in
    // container coordinates that no longer match the underlying tiles.
    function hardClear() {
      particlesRef.current = [];
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    resize();
    let panning = false;
    map.on("movestart zoomstart", () => {
      panning = true;
      hardClear();
    });
    map.on("moveend zoomend", () => {
      panning = false;
      hardClear();
    });
    map.on("resize", () => {
      resize();
      hardClear();
    });

    let spawnAccum = 0;
    const SPAWN_PER_SOURCE = 1.2;
    const PARTICLE_LIFE = 110;

    function tick() {
      // While the user is panning/zooming, don't draw — the canvas stays
      // fixed in container space while the tiles move underneath. Drawing
      // during pan would smear particles across the wrong geography.
      if (panning) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Aggressive trail fade so any stragglers disappear within ~30 frames.
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";

      // Spawn from active sources.
      spawnAccum += SPAWN_PER_SOURCE;
      const spawnEach = Math.floor(spawnAccum);
      spawnAccum -= spawnEach;

      const sources = incidentsRef.current.filter(
        (i) => i.status === "EMERGING" || i.status === "UNREPORTED" || i.status === "CREWS_ACTIVE",
      );

      if (spawnEach > 0) {
        for (const src of sources) {
          // Convert wind FROM direction to spread TO direction.
          const toDeg = (src.windDirDeg + 180) % 360;
          const toRad = (toDeg * Math.PI) / 180;
          // Velocity in m/s — fuel-factor-scaled.
          const fuelFactor = src.fuelFactor ?? 0.7;
          const speedMs = src.windSpeedMs * fuelFactor * 0.45; // ember + flame-front blend
          // Convert m/s → deg/frame at this latitude.
          // 1° lat ≈ 111 km; 1° lon ≈ 111 km × cos(lat).
          const cosLat = Math.cos((src.lat * Math.PI) / 180);
          const dLatPerSec = (speedMs * Math.cos(-toRad + Math.PI / 2)) / 111_000;
          const dLonPerSec = (speedMs * Math.sin(-toRad + Math.PI / 2)) / (111_000 * cosLat);
          // Compress 1 sim-second into ~30 frames so motion is visible.
          const FRAME_TO_SIM = 30;
          const baseColor = hexToRgb(STATUS_COLOR[src.status]);
          for (let i = 0; i < spawnEach; i++) {
            // Angular jitter for ember cone.
            const jitter = (Math.random() - 0.5) * 0.5;
            const c = Math.cos(jitter);
            const s = Math.sin(jitter);
            const vLat = (dLatPerSec * c - dLonPerSec * s) / FRAME_TO_SIM;
            const vLon = (dLatPerSec * s + dLonPerSec * c) / FRAME_TO_SIM;
            // Initial radius offset so particles don't start exactly on the marker.
            const r0 = (Math.random() * 200) / 111_000; // up to 200 m
            const a0 = Math.random() * Math.PI * 2;
            particlesRef.current.push({
              lat: src.lat + Math.cos(a0) * r0,
              lon: src.lon + (Math.sin(a0) * r0) / cosLat,
              vLat,
              vLon,
              age: 0,
              life: PARTICLE_LIFE * (0.7 + Math.random() * 0.6),
              baseColor,
            });
          }
        }
      }

      const next: Particle[] = [];
      for (const p of particlesRef.current) {
        p.age += 1;
        if (p.age >= p.life) continue;
        // Slight buoyant drift north (fire convection), tiny.
        p.vLat += 0.0000003;
        p.vLat *= 0.997;
        p.vLon *= 0.997;
        p.lat += p.vLat;
        p.lon += p.vLon;
        const containerPoint = map!.latLngToContainerPoint([p.lat, p.lon]);
        if (
          containerPoint.x < 0 ||
          containerPoint.y < 0 ||
          containerPoint.x > canvas.clientWidth ||
          containerPoint.y > canvas.clientHeight
        ) {
          continue;
        }
        const lifeFrac = p.age / p.life;
        const alpha = Math.max(0, 1 - lifeFrac) * 0.92;
        // Ember → smoke color shift.
        const t = Math.min(1, lifeFrac * 1.4);
        const r = Math.round(p.baseColor[0] * (1 - t) + 110 * t);
        const g = Math.round(p.baseColor[1] * (1 - t) + 110 * t);
        const b = Math.round(p.baseColor[2] * (1 - t) + 110 * t);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        const radius = 1.5 + (1 - lifeFrac) * 1.8;
        ctx.beginPath();
        ctx.arc(containerPoint.x, containerPoint.y, radius, 0, Math.PI * 2);
        ctx.fill();
        next.push(p);
      }
      particlesRef.current = next.length > 8000 ? next.slice(-8000) : next;

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      className={className ?? "border-border relative w-full overflow-hidden rounded-lg border"}
      style={{ height }}
    >
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-[400]"
        aria-hidden
      />

      {/* Consolidated map controls — single shadcn-styled card. Tabs for the
          basemap segmented toggle, Switches for the layer toggles. No
          gradients; uses the workspace's default --primary token. The card
          sits at top-right (top-left is reserved for the hazard switcher). */}
      <Card className="absolute right-4 top-4 z-[401] w-[200px] gap-0 border-border/60 bg-card/85 p-2 shadow-lg backdrop-blur-md supports-[backdrop-filter]:bg-card/70">
        <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Basemap
        </div>
        <Tabs value={basemap} onValueChange={(v) => setBasemap(v as typeof basemap)}>
          <TabsList className="grid h-7 w-full grid-cols-3 bg-muted/60 p-0.5">
            <TabsTrigger value="streets" className="h-6 px-2 text-[10px] font-medium uppercase">
              Map
            </TabsTrigger>
            <TabsTrigger value="satellite" className="h-6 px-2 text-[10px] font-medium uppercase">
              Sat
            </TabsTrigger>
            <TabsTrigger value="terrain" className="h-6 px-2 text-[10px] font-medium uppercase">
              Topo
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Separator className="my-2" />
        <div className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Layers
        </div>
        <label
          htmlFor="ll-ml-spread"
          className="flex cursor-pointer items-center justify-between rounded-md px-1.5 py-1 text-[11px] text-foreground hover:bg-muted/60"
          title="ML predicted 50% spread @ 1h / 6h / 24h"
        >
          <span>ML spread</span>
          <Switch
            id="ll-ml-spread"
            checked={showContours}
            onCheckedChange={setShowContours}
            className="h-4 w-7 [&>span]:h-3 [&>span]:w-3"
          />
        </label>
        {!publicOnly && (
          <label
            htmlFor="ll-stations"
            className="flex cursor-pointer items-center justify-between rounded-md px-1.5 py-1 text-[11px] text-foreground hover:bg-muted/60"
            title="Nearest fire stations"
          >
            <span>Stations</span>
            <Switch
              id="ll-stations"
              checked={showStations}
              onCheckedChange={setShowStations}
              className="h-4 w-7 [&>span]:h-3 [&>span]:w-3"
            />
          </label>
        )}
      </Card>
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ─────────────── Spread geometry helpers ───────────────
//
// Ellipse model: fire growth is rarely circular. Wind-driven runs produce a
// length-to-breadth ratio of ~3:1 to 8:1. We use a 2.5:1 axis ratio at low
// horizons and 1.4:1 at long horizons (because the prediction's confidence
// circle widens). The bearing is along the wind/spread direction.

const ACRE_M2 = 4046.8564224;

export function areaAcresToMajorRadiusM(areaAcres: number): number {
  // Effective semi-major radius, treating the ellipse area as A = π · a · b
  // and assuming an axis ratio of 2.5:1 (a / b = 2.5), so b = a / 2.5
  // → A = π · a² / 2.5 → a = sqrt(2.5 · A / π).
  const m2 = areaAcres * ACRE_M2;
  return Math.sqrt((2.5 * m2) / Math.PI);
}

function ellipseFromArea(
  lat: number,
  lon: number,
  areaAcres: number,
  bearingDeg: number,
  segments = 48,
): [number, number][] {
  const semiMajor = areaAcresToMajorRadiusM(areaAcres);
  const semiMinor = semiMajor / 2.5;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  // Bearing to math-radians (0° = N, CW; math is 0° = E, CCW).
  const theta = ((90 - bearingDeg) * Math.PI) / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  // Anchor the back of the ellipse at the hotspot and let the head extend in
  // the bearing direction (real fire ellipses anchor near the heel, not the
  // centroid). Translate by +semiMajor along bearing.
  const ax = semiMajor * cosT;
  const ay = semiMajor * sinT;
  const points: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const phi = (2 * Math.PI * i) / segments;
    const ex = semiMajor * Math.cos(phi);
    const ey = semiMinor * Math.sin(phi);
    // Rotate by theta + translate the major-axis offset (anchor heel at hotspot).
    const x = ex * cosT - ey * sinT + ax;
    const y = ex * sinT + ey * cosT + ay;
    const dLat = y / 111_000;
    const dLon = x / (111_000 * cosLat);
    points.push([lat + dLat, lon + dLon]);
  }
  return points;
}

function offsetByMeters(
  lat: number,
  lon: number,
  meters: number,
  bearingDeg: number,
): [number, number] {
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const theta = ((90 - bearingDeg) * Math.PI) / 180;
  const dx = meters * Math.cos(theta);
  const dy = meters * Math.sin(theta);
  return [lat + dy / 111_000, lon + dx / (111_000 * cosLat)];
}
