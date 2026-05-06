"use client";

import { useMemo } from "react";
import { UsMap, type MapHotspot } from "./UsMap";
import { FireParticles, type ParticleSource } from "./FireParticles";
import { ALBERS_WIDTH, ALBERS_HEIGHT, projectLonLat } from "./projection";

export interface SentryMapHotspot extends MapHotspot {
  /** Optional spread bearing for the particle origin. Falls back to wind. */
  spreadBearingDeg?: number;
}

interface SentryMapProps {
  hotspots: SentryMapHotspot[];
  publicOnly?: boolean;
  onHotspotClick?: (id: string) => void;
  /** Aspect-locked container; ratio enforced via the wrapper's aspect-[975/610]. */
  className?: string;
}

const COLOR_BY_STATUS: Record<MapHotspot["status"], string> = {
  EMERGING: "#f97316",
  CREWS_ACTIVE: "#fbbf24",
  UNREPORTED: "#a1a1aa",
  KNOWN_PRESCRIBED: "#3b82f6",
  LIKELY_INDUSTRIAL: "#a855f7",
};

export function SentryMap({
  hotspots,
  publicOnly = false,
  onHotspotClick,
  className,
}: SentryMapProps) {
  // Project all sources up front so the canvas doesn't redo it every frame.
  const particleSources = useMemo<ParticleSource[]>(() => {
    return hotspots
      .map((h) => {
        if (publicOnly && h.status !== "EMERGING" && h.status !== "CREWS_ACTIVE") return null;
        const p = projectLonLat(h.lon, h.lat);
        if (!p) return null;
        return {
          id: h.id,
          x: p[0],
          y: p[1],
          windDirDeg: h.windDirDeg ?? 0,
          windSpeedMs: h.windSpeedMs ?? 0,
          active:
            h.status === "EMERGING" || h.status === "UNREPORTED" || h.status === "CREWS_ACTIVE",
          color: COLOR_BY_STATUS[h.status],
        };
      })
      .filter(Boolean) as ParticleSource[];
  }, [hotspots, publicOnly]);

  return (
    <div
      className={
        className ?? "border-border relative w-full overflow-hidden rounded-lg border bg-zinc-950"
      }
      style={{ aspectRatio: `${ALBERS_WIDTH} / ${ALBERS_HEIGHT}` }}
    >
      <UsMap
        hotspots={hotspots}
        publicOnly={publicOnly}
        onHotspotClick={onHotspotClick}
        className="absolute inset-0 h-full w-full"
      />
      <div className="pointer-events-none absolute inset-0">
        <FireParticles sources={particleSources} />
      </div>
    </div>
  );
}
