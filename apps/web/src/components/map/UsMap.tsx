"use client";

import { useMemo } from "react";
import { albersPath, ALBERS_WIDTH, ALBERS_HEIGHT, projectLonLat } from "./projection";
import {
  STATES_ALBERS,
  STATE_BORDERS_MESH,
  NATION_OUTLINE_MESH,
} from "./us-map-data";

export interface MapHotspot {
  id: string;
  lat: number;
  lon: number;
  status: "EMERGING" | "CREWS_ACTIVE" | "UNREPORTED" | "KNOWN_PRESCRIBED" | "LIKELY_INDUSTRIAL";
  /** wind direction degrees, 0 = from N, meteorological "from" convention */
  windDirDeg?: number;
  windSpeedMs?: number;
  selected?: boolean;
  shortId?: string;
}

const STATUS_FILL: Record<MapHotspot["status"], string> = {
  EMERGING: "#f97316",
  CREWS_ACTIVE: "#10b981",
  UNREPORTED: "#a1a1aa",
  KNOWN_PRESCRIBED: "#3b82f6",
  LIKELY_INDUSTRIAL: "#a855f7",
};

interface UsMapProps {
  hotspots: MapHotspot[];
  /** When true, dim non-public statuses for the public awareness map. */
  publicOnly?: boolean;
  /** Click handler on a hotspot. */
  onHotspotClick?: (id: string) => void;
  /** Called once per hotspot at render time so the parent can overlay
   *  matching canvas particles on top. */
  onProjected?: (projected: { id: string; x: number; y: number; hotspot: MapHotspot }[]) => void;
  className?: string;
}

export function UsMap({
  hotspots,
  publicOnly = false,
  onHotspotClick,
  onProjected,
  className,
}: UsMapProps) {
  const visibleHotspots = useMemo(
    () =>
      publicOnly
        ? hotspots.filter((h) => h.status === "EMERGING" || h.status === "CREWS_ACTIVE")
        : hotspots,
    [hotspots, publicOnly],
  );

  const projected = useMemo(() => {
    return visibleHotspots
      .map((h) => {
        const p = projectLonLat(h.lon, h.lat);
        if (!p) return null;
        return { id: h.id, x: p[0], y: p[1], hotspot: h };
      })
      .filter(Boolean) as { id: string; x: number; y: number; hotspot: MapHotspot }[];
  }, [visibleHotspots]);

  // Notify parent — used to drive the canvas particle overlay (which lives in
  // a sibling element so it can use absolute positioning).
  if (onProjected) onProjected(projected);

  // Pre-compute SVG path d strings on every render. Cheap; the topology is small.
  const statePaths = STATES_ALBERS.features.map((f) => ({
    name: (f.properties as { name: string }).name,
    d: albersPath(f) ?? "",
  }));
  const stateBordersD = albersPath(STATE_BORDERS_MESH) ?? "";
  const nationD = albersPath(NATION_OUTLINE_MESH) ?? "";

  return (
    <svg
      viewBox={`0 0 ${ALBERS_WIDTH} ${ALBERS_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label="Map of the contiguous United States with active fire detections"
    >
      <defs>
        <linearGradient id="land-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(39 39 42)" />
          <stop offset="100%" stopColor="rgb(24 24 27)" />
        </linearGradient>
        <radialGradient id="hotglow-em" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hotglow-cr" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
        <pattern id="topo-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M 0 6 L 6 0" fill="none" stroke="rgba(120,113,108,0.05)" strokeWidth="0.6" />
        </pattern>
      </defs>

      {/* Ocean / outside-CONUS background */}
      <rect width={ALBERS_WIDTH} height={ALBERS_HEIGHT} fill="rgb(8 8 10)" />

      {/* Per-state fills */}
      <g>
        {statePaths.map((s) => (
          <path
            key={s.name}
            d={s.d}
            fill="url(#land-grad)"
            stroke="rgb(63 63 70)"
            strokeWidth={0.6}
          >
            <title>{s.name}</title>
          </path>
        ))}
      </g>

      {/* Topographic hatch overlay for "landscape" feel */}
      <path d={nationD} fill="url(#topo-hatch)" stroke="none" pointerEvents="none" />

      {/* Crisp interior state borders */}
      <path
        d={stateBordersD}
        fill="none"
        stroke="rgb(82 82 91)"
        strokeWidth={0.55}
        pointerEvents="none"
      />

      {/* Nation outline */}
      <path
        d={nationD}
        fill="none"
        stroke="rgb(113 113 122)"
        strokeWidth={1}
        pointerEvents="none"
      />

      {/* Hotspot glows */}
      <g>
        {projected.map((p) => {
          const fillId =
            p.hotspot.status === "EMERGING"
              ? "url(#hotglow-em)"
              : p.hotspot.status === "CREWS_ACTIVE"
              ? "url(#hotglow-cr)"
              : null;
          if (!fillId) return null;
          return (
            <circle
              key={`glow-${p.id}`}
              cx={p.x}
              cy={p.y}
              r={p.hotspot.selected ? 36 : 22}
              fill={fillId}
              pointerEvents="none"
            />
          );
        })}
      </g>

      {/* Hotspot dots */}
      <g>
        {projected.map((p) => {
          const isAlive = p.hotspot.status === "EMERGING" || p.hotspot.status === "UNREPORTED";
          return (
            <g
              key={p.id}
              onClick={() => onHotspotClick?.(p.id)}
              className={onHotspotClick ? "cursor-pointer" : undefined}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={p.hotspot.selected ? 8 : 5}
                fill={STATUS_FILL[p.hotspot.status]}
                stroke="white"
                strokeWidth={p.hotspot.selected ? 2 : 1.4}
              >
                {isAlive && (
                  <animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite" />
                )}
              </circle>
              {p.hotspot.selected && p.hotspot.shortId && (
                <text
                  x={p.x + 11}
                  y={p.y - 8}
                  fontSize={11}
                  fill="white"
                  className="font-mono"
                  pointerEvents="none"
                >
                  {p.hotspot.shortId}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
