"use client";

// Live USGS earthquake map. Pulls the public GeoJSON feed (all earthquakes
// in the last 24h, no auth required), renders magnitude-scaled markers on a
// Leaflet basemap. Click a marker → ETAS-prior aftershock probability card
// (computed in-browser using the same Omori-Utsu / Gutenberg-Richter formulas
// from ml/models/aftershock_etas_npp.py, just ported to TypeScript).
//
// This is a real, working surface — not a placeholder.

import { useEffect, useRef, useState } from "react";
import L, { type Map as LMap, type Marker as LMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

interface USGSFeature {
  id: string;
  type: "Feature";
  properties: {
    mag: number | null;
    place: string;
    time: number;
    url: string;
    title: string;
    sig: number;
    tsunami: number;
    type: string;
    magType: string | null;
  };
  geometry: { type: "Point"; coordinates: [number, number, number] };
}

interface USGSResponse {
  type: "FeatureCollection";
  metadata: { generated: number; title: string; count: number };
  features: USGSFeature[];
}

// ETAS / Gutenberg-Richter parameters — same defaults as the Python model
// at ml/models/aftershock_etas_npp.py (ETASParams). M_c = 2.5, b = 1.0,
// alpha = 1.65, K = 0.0089, c = 0.012 days, p = 1.07.
const M_C = 2.5;
const B_GR = 1.0;
const ALPHA = 1.65;
const K_PROD = 0.0089;
const C_OMORI = 0.012;
const P_OMORI = 1.07;
const SPATIAL_KM = 30.0;
const MU_BG = 1.5e-4;

function omoriUtsu(magnitude: number, dtDays: number, distKm: number): number {
  if (magnitude < M_C) return 0;
  const magTerm = Math.pow(10, ALPHA * (magnitude - M_C));
  const omori = 1.0 / Math.pow(dtDays + C_OMORI, P_OMORI);
  const spatial = Math.exp(-Math.pow(distKm / SPATIAL_KM, 2));
  return K_PROD * magTerm * omori * spatial;
}

function pAboveGR(mTarget: number): number {
  return mTarget <= M_C ? 1.0 : Math.pow(10, -B_GR * (mTarget - M_C));
}

function pAftershock(magnitude: number, hoursSince: number, mTarget = 4.0): number {
  const dtDays = Math.max(0.01, hoursSince / 24);
  const lambda = MU_BG + omoriUtsu(magnitude, dtDays, 0);
  const horizonDays = 1.0;
  const pAny = 1.0 - Math.exp(-lambda * horizonDays);
  return Math.min(1, Math.max(0, pAny * pAboveGR(mTarget)));
}

function magToColor(mag: number): string {
  if (mag >= 6) return "#ef4444"; // red — major
  if (mag >= 5) return "#f97316"; // orange — moderate-strong
  if (mag >= 4) return "#eab308"; // yellow — light-moderate
  if (mag >= 3) return "#22c55e"; // green — minor
  return "#64748b"; // slate — micro
}

function magToRadius(mag: number): number {
  return Math.max(4, Math.min(28, mag * mag * 1.6));
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function EarthquakeMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const [features, setFeatures] = useState<USGSFeature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<USGSFeature | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", {
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error(`USGS HTTP ${r.status}`);
        return r.json() as Promise<USGSResponse>;
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !features) return;
    const map = L.map(containerRef.current, {
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: false,
    }).setView([20, 0], 2);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      { subdomains: "abcd", maxZoom: 19 },
    ).addTo(map);
    mapRef.current = map;

    const markers: LMarker[] = [];
    features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const mag = f.properties.mag ?? 0;
      const radius = magToRadius(mag);
      const color = magToColor(mag);
      const html = `
        <div style="position:relative;width:${radius * 2}px;height:${radius * 2}px;">
          <div style="position:absolute;inset:0;border-radius:50%;background:${color}33;"></div>
          <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${radius}px;height:${radius}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 8px ${color}cc;"></div>
        </div>`;
      const m = L.marker([lat, lon], {
        icon: L.divIcon({
          html,
          className: "",
          iconSize: [radius * 2, radius * 2],
          iconAnchor: [radius, radius],
        }),
      });
      m.on("click", () => setSelected(f));
      m.addTo(map);
      markers.push(m);
    });

    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [features]);

  return (
    <div className="relative h-full w-full bg-background">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      {/* Loading / error state. */}
      {!features && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="text-xs text-muted-foreground">Pulling USGS earthquake feed…</div>
          </div>
        </div>
      )}
      {error && (
        <Card className="absolute left-4 top-4 z-[401] w-72 p-3">
          <div className="text-xs font-medium text-destructive">USGS feed unavailable</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{error}</div>
        </Card>
      )}
      {features && (
        <Card className="absolute right-4 top-4 z-[401] w-[280px] gap-0 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              USGS · last 24h · M ≥ 2.5
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {features.length}
            </Badge>
          </div>
          <ScrollArea className="mt-2 h-[260px] pr-2">
            <ul className="space-y-1.5">
              {features.slice(0, 60).map((f) => {
                const mag = f.properties.mag ?? 0;
                const hoursSince = (Date.now() - f.properties.time) / 3.6e6;
                const p4 = pAftershock(mag, hoursSince, 4.0);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(f)}
                      className="w-full rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition hover:border-border hover:bg-muted"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: magToColor(mag) }}
                        />
                        <span className="font-mono font-semibold">M{mag.toFixed(1)}</span>
                        <span className="ml-auto text-muted-foreground">
                          {timeAgo(f.properties.time)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {f.properties.place}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        ETAS P(M≥4 in 24h): <span className="text-foreground">{(p4 * 100).toFixed(2)}%</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        </Card>
      )}
      {selected && (
        <Card className="absolute bottom-4 left-4 z-[401] w-[360px] p-4">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: magToColor(selected.properties.mag ?? 0) }}
            />
            <span className="font-mono text-lg font-bold">
              M{(selected.properties.mag ?? 0).toFixed(1)}
            </span>
            <Badge variant="secondary">{selected.properties.magType ?? "ml"}</Badge>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <div className="mt-1 text-sm">{selected.properties.place}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {timeAgo(selected.properties.time)} · {selected.geometry.coordinates[1].toFixed(3)},{" "}
            {selected.geometry.coordinates[0].toFixed(3)} · depth{" "}
            {selected.geometry.coordinates[2].toFixed(1)} km
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            {[3.0, 4.0, 5.0].map((target) => {
              const hoursSince = (Date.now() - selected.properties.time) / 3.6e6;
              const p = pAftershock(selected.properties.mag ?? 0, hoursSince, target);
              return (
                <div key={target} className="rounded-md border border-border bg-muted/40 p-2 text-center">
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">
                    P(M≥{target}, 24h)
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-semibold">
                    {(p * 100).toFixed(2)}%
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-muted-foreground">
            ETAS-prior aftershock probability — same Omori-Utsu / Gutenberg-Richter
            formulation as <code className="text-foreground">ml/models/aftershock_etas_npp.py</code>.
            Neural-residual head not yet wired (no trained weights).
          </div>
          <a
            href={selected.properties.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-[11px] text-primary underline-offset-2 hover:underline"
          >
            USGS event page →
          </a>
        </Card>
      )}
    </div>
  );
}
