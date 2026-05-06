"use client";

// UnitRouteBadge — a sleek, Apple-Maps-style camera-facing pill badge that
// floats above an in-flight unit. Renders DOM via drei's <Html> in sprite mode
// (always faces the camera, fixed pixel size relative to zoom). Shows a role
// icon, the unit name, a colored ETA "M:SS" countdown that pulses, and a
// status sub-label. When the ETA is critically short, the whole pill flips
// into an amber-pulse "imminent arrival" state.

import { Html } from "@react-three/drei";

export type UnitKind = "engine" | "helicopter" | "fixed-wing" | "dozer" | "hand-crew";
export type UnitStatus = "ENROUTE" | "STAGING" | "ON_SCENE" | "RTB";

interface UnitRouteBadgeProps {
  position: [number, number, number];
  kind: UnitKind;
  name: string;
  etaSeconds: number;
  status: UnitStatus;
  /** Accent color for the unit (used to tint the ETA digits). */
  color: string;
}

const KIND_ICON: Record<UnitKind, string> = {
  helicopter: "🚁",
  "fixed-wing": "✈️",
  engine: "🚒",
  dozer: "🚜",
  "hand-crew": "🥾",
};

const STATUS_PILL: Record<UnitStatus, string> = {
  ENROUTE: "bg-amber-400/20 text-amber-200 border-amber-300/30",
  STAGING: "bg-blue-400/20 text-blue-200 border-blue-300/30",
  ON_SCENE: "bg-emerald-400/20 text-emerald-200 border-emerald-300/30",
  RTB: "bg-zinc-400/20 text-zinc-200 border-zinc-300/30",
};

const URGENT_THRESHOLD_SECONDS = 30;

function formatEta(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  const mm = String(minutes);
  const ss = String(remainder).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function UnitRouteBadge({
  position,
  kind,
  name,
  etaSeconds,
  status,
  color,
}: UnitRouteBadgeProps) {
  const urgent = etaSeconds <= URGENT_THRESHOLD_SECONDS && status === "ENROUTE";
  const containerClass = urgent
    ? "flex flex-col items-center gap-0.5 rounded-full border border-amber-200/60 bg-amber-500/90 px-3 py-1.5 text-black shadow-lg shadow-amber-500/30 animate-pulse"
    : "flex flex-col items-center gap-0.5 rounded-full border border-white/15 bg-black/80 px-3 py-1.5 text-white shadow-lg shadow-black/40 backdrop-blur-md";

  const etaClass = urgent
    ? "font-mono text-[13px] font-semibold tabular-nums text-black animate-pulse"
    : "font-mono text-[13px] font-semibold tabular-nums animate-pulse";

  // Inline color via Tailwind arbitrary-value class so we still avoid raw
  // style objects. The accent color is unit-driven and not always in palette.
  const etaColorClass = urgent ? "" : `[color:${color}]`;

  return (
    <Html
      position={position}
      transform={false}
      sprite
      distanceFactor={8}
      center
      pointerEvents="none"
      zIndexRange={[100, 0]}
      wrapperClass="pointer-events-none select-none"
    >
      <div className={containerClass}>
        <div className="flex items-center gap-1.5 leading-none">
          <span aria-hidden className="text-[14px]">
            {KIND_ICON[kind]}
          </span>
          <span className="text-[12px] font-semibold tracking-wide">{name}</span>
          <span className={`${etaClass} ${etaColorClass}`}>{formatEta(etaSeconds)}</span>
        </div>
        <div className="flex items-center gap-1 leading-none">
          <span
            className={`rounded-full border px-1.5 py-[1px] text-[9px] font-semibold tracking-[0.08em] ${
              urgent ? "border-black/30 bg-black/15 text-black" : STATUS_PILL[status]
            }`}
          >
            {status}
          </span>
          <span
            aria-hidden
            className={`text-[8px] leading-none ${urgent ? "text-black/70" : "text-white/60"}`}
          >
            ▼
          </span>
        </div>
      </div>
    </Html>
  );
}
