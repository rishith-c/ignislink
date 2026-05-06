"use client";

// Right-sidebar list that swaps into the dispatcher console when the
// hazard switcher is set to "earthquake". Pulls live USGS GeoJSON, lists
// recent quakes with magnitude / place / age / ETAS-prior P(M≥4 in 24h).
//
// Companion to EarthquakeMap. The map renders epicenter rings + Leaflet
// popup; the sidebar gives a scannable, sortable summary that doesn't
// move with the map.

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface USGSFeature {
  id: string;
  properties: { mag: number | null; place: string; time: number; magType: string | null; url: string };
  geometry: { coordinates: [number, number, number] };
}

const M_C = 2.5;
const ALPHA = 1.65;
const K = 0.0089;
const C = 0.012;
const P = 1.07;

function pAftershock(mag: number, hoursSince: number, mTarget = 4.0): number {
  if (mag < M_C) return 0;
  const dtDays = Math.max(0.01, hoursSince / 24);
  const lambda = 1.5e-4 + K * Math.pow(10, ALPHA * (mag - M_C)) / Math.pow(dtDays + C, P);
  const pAny = 1 - Math.exp(-lambda * 1.0);
  const pMag = mTarget <= M_C ? 1 : Math.pow(10, -(mTarget - M_C));
  return Math.min(1, Math.max(0, pAny * pMag));
}

function magToColor(mag: number): string {
  if (mag >= 6) return "#ef4444";
  if (mag >= 5) return "#f97316";
  if (mag >= 4) return "#eab308";
  if (mag >= 3) return "#22c55e";
  return "#64748b";
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function EarthquakeSidebar() {
  const [features, setFeatures] = useState<USGSFeature[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`USGS HTTP ${r.status}`);
        return r.json() as Promise<{ features: USGSFeature[] }>;
      })
      .then((j) => {
        if (!alive) return;
        const filtered = j.features
          .filter((f) => f.properties.mag !== null && (f.properties.mag ?? 0) >= M_C)
          .sort((a, b) => (b.properties.mag ?? 0) - (a.properties.mag ?? 0));
        setFeatures(filtered);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "fetch failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-border bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Earthquake feed</h2>
          {features && (
            <Badge variant="secondary" className="text-[10px]">
              {features.length} events
            </Badge>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Live USGS GeoJSON · last 24h · M ≥ 2.5 · ETAS-prior aftershock probability
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="divide-y divide-border">
          {!features && !error && (
            <li className="space-y-2 p-4">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </li>
          )}
          {error && (
            <li className="p-4 text-xs text-destructive">USGS feed unavailable — {error}</li>
          )}
          {features?.map((f) => {
            const mag = f.properties.mag ?? 0;
            const hoursSince = (Date.now() - f.properties.time) / 3.6e6;
            const p4 = pAftershock(mag, hoursSince, 4.0);
            const color = magToColor(mag);
            return (
              <li key={f.id} className="px-4 py-3 transition hover:bg-accent/40">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}aa` }}
                  >
                    M{mag.toFixed(1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">
                      {f.properties.place}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{timeAgo(f.properties.time)} ago</span>
                      <span>·</span>
                      <span>{f.geometry.coordinates[2].toFixed(0)} km depth</span>
                      <span>·</span>
                      <span>{(f.properties.magType ?? "ml").toLowerCase()}</span>
                    </div>
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]">
                      <span className="text-muted-foreground">P(M≥4, 24h)</span>
                      <span className="font-mono font-semibold text-foreground">
                        {(p4 * 100).toFixed(2)}%
                      </span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </ScrollArea>
    </>
  );
}
