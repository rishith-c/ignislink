"use client";

// Thin wrapper around FireSimulator3D that fetches the live DEM (AWS
// Terrain Tiles) and the spatial wind grid (Open-Meteo) via TanStack
// Query and passes them in as optional props. When `bbox` is provided
// the wrapper lights up real-data mode; otherwise it forwards through
// to the procedural-terrain + uniform-wind fallback that has shipped
// since v1 of the simulator.
//
// This file exists so /console/page.tsx (the MapPanel parent) doesn't
// need to know about TanStack Query keys or fetch lifetimes — and so
// agents A/B/C can land their FireSimulator3D edits on parallel branches
// without conflicting on the prop wiring.

import { useMemo } from "react";

import { FireSimulator3D } from "@/components/map/FireSimulator3D";
import type { Bbox } from "@/lib/geo/bbox";
import { useDemHeightmap } from "@/lib/hooks/useDemHeightmap";
import { useWindGrid } from "@/lib/hooks/useWindGrid";

interface FireSimulator3DLiveProps {
  bbox: Bbox | null;
  windDirDeg: number;
  windSpeedMs: number;
  predicted1hAcres?: number;
  predicted6hAcres?: number;
  predicted24hAcres?: number;
  risk?: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  resources?: React.ComponentProps<typeof FireSimulator3D>["resources"];
  landmarks?: React.ComponentProps<typeof FireSimulator3D>["landmarks"];
  lowDetail?: boolean;
  /** FIRMS hotspots forwarded through to the underlying simulator (Agent A). */
  hotspots?: React.ComponentProps<typeof FireSimulator3D>["hotspots"];
  /** Camera-tour mode forwarded through (Agent A). */
  tourMode?: boolean;
}

const TERRAIN_RES = 96;

export function FireSimulator3DLive(props: FireSimulator3DLiveProps) {
  const enabled = Boolean(props.bbox);
  const { heightmap } = useDemHeightmap({
    bbox: props.bbox,
    resolution: TERRAIN_RES,
    vScale: 0.6,
    enabled,
  });
  const { grid } = useWindGrid({
    bbox: props.bbox,
    fallbackWindDirDeg: props.windDirDeg,
    fallbackWindSpeedMs: props.windSpeedMs,
    enabled,
  });

  // useMemo so the prop reference is stable across renders — the
  // simulator's heightmap is only re-applied when the buffer actually
  // changes (cuts visible "twitch" between background fetches).
  const heightmapProp = useMemo(() => heightmap, [heightmap]);

  return (
    <FireSimulator3D
      windDirDeg={props.windDirDeg}
      windSpeedMs={props.windSpeedMs}
      predicted1hAcres={props.predicted1hAcres}
      predicted6hAcres={props.predicted6hAcres}
      predicted24hAcres={props.predicted24hAcres}
      risk={props.risk}
      resources={props.resources}
      landmarks={props.landmarks}
      lowDetail={props.lowDetail}
      demHeightmap={heightmapProp}
      windGrid={grid}
      hotspots={props.hotspots}
      bbox={props.bbox ?? undefined}
      tourMode={props.tourMode}
    />
  );
}
