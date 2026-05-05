"use client";

// Live USGS flood / river-stage map. Pulls the USGS Instantaneous Values
// service for active flood-stage gauges (parameter 00065 = gauge stage),
// renders gauge markers on Leaflet, click → recent stage timeline + a
// simple persistence forecast (24h / 48h heuristic that mirrors the
// EA-LSTM contract from ml/models/flood_ealstm.py — quantile bands).
//
// Real working surface backed by waterservices.usgs.gov. No auth needed.

import { useEffect, useRef, useState } from "react";
import L, { type Map as LMap, type Marker as LMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiBaseUrl } from "@/lib/api/client";

interface FloodMapProps {
  // When true, route requests through the FastAPI backend's
  // /floods/gauges?state=ca endpoint instead of USGS NWIS directly.
  viaBackend?: boolean;
}

interface USGSValue {
  value: string;
  qualifiers: string[];
  dateTime: string;
}

interface USGSTimeSeries {
  sourceInfo: {
    siteName: string;
    siteCode: { value: string }[];
    geoLocation: { geogLocation: { latitude: number; longitude: number } };
  };
  variable: {
    variableCode: { value: string }[];
    variableName: string;
    unit: { unitCode: string };
    variableDescription: string;
  };
  values: { value: USGSValue[]; qualifier?: unknown[] }[];
}

interface USGSWaterResponse {
  value: { timeSeries: USGSTimeSeries[] };
}

interface GaugeRow {
  siteCode: string;
  siteName: string;
  lat: number;
  lon: number;
  unit: string;
  values: { dateTime: string; value: number }[];
  latestValue: number | null;
  latestTime: string | null;
}

// Pull stage observations from the USGS Instantaneous-Values service.
// USGS caps bbox queries to ~3 degrees, so we filter by `stateCd=ca`
// instead — covers the whole CA demo region without the size limit.
// Parameter 00065 = gauge height (ft).
const USGS_URL =
  `https://waterservices.usgs.gov/nwis/iv/?format=json` +
  `&stateCd=ca` +
  `&parameterCd=00065` +
  `&siteStatus=active` +
  `&period=PT24H`;

function parseTimeSeries(data: USGSWaterResponse): GaugeRow[] {
  const rows: GaugeRow[] = [];
  for (const ts of data.value.timeSeries) {
    const code = ts.sourceInfo.siteCode[0]?.value;
    if (!code) continue;
    const lat = ts.sourceInfo.geoLocation?.geogLocation?.latitude;
    const lon = ts.sourceInfo.geoLocation?.geogLocation?.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const block = ts.values[0];
    if (!block) continue;
    const values = block.value
      .map((v) => ({ dateTime: v.dateTime, value: parseFloat(v.value) }))
      .filter((v) => Number.isFinite(v.value) && v.value !== -999999);
    if (values.length === 0) continue;
    const last = values[values.length - 1] ?? null;
    rows.push({
      siteCode: code,
      siteName: ts.sourceInfo.siteName,
      lat,
      lon,
      unit: ts.variable.unit.unitCode,
      values,
      latestValue: last?.value ?? null,
      latestTime: last?.dateTime ?? null,
    });
  }
  return rows;
}

// Persistence + slope baseline for short-horizon stage forecast. This mirrors
// the SHAPE of the EA-LSTM quantile head from ml/models/flood_ealstm.py
// (3 horizons × 3 quantiles) but uses observed-trend extrapolation since we
// don't have trained weights yet. Replace with ONNX inference once weights ship.
function quantileForecast(
  values: { dateTime: string; value: number }[],
): { horizonHours: number; q10: number; q50: number; q90: number }[] {
  if (values.length < 2) return [];
  const last = values[values.length - 1]?.value ?? 0;
  const window = values.slice(-Math.min(values.length, 24));
  const slopePerHour =
    window.length > 1
      ? (window[window.length - 1]!.value - window[0]!.value) /
        Math.max(
          1,
          (new Date(window[window.length - 1]!.dateTime).getTime() -
            new Date(window[0]!.dateTime).getTime()) /
            3.6e6,
        )
      : 0;
  // Empirical noise: stdev of stage over the lookback window.
  const mean = window.reduce((s, v) => s + v.value, 0) / window.length;
  const variance =
    window.reduce((s, v) => s + (v.value - mean) ** 2, 0) / Math.max(1, window.length - 1);
  const sigma = Math.sqrt(variance);
  return [6, 24, 48].map((h) => {
    const central = last + slopePerHour * h;
    const spread = sigma * Math.sqrt(h / 6);
    return {
      horizonHours: h,
      q10: central - 1.28 * spread,
      q50: central,
      q90: central + 1.28 * spread,
    };
  });
}

function stageBand(stageFt: number): "low" | "normal" | "elevated" | "flood" {
  if (stageFt < 1) return "low";
  if (stageFt < 5) return "normal";
  if (stageFt < 10) return "elevated";
  return "flood";
}
const BAND_COLOR: Record<ReturnType<typeof stageBand>, string> = {
  low: "#64748b",
  normal: "#22c55e",
  elevated: "#eab308",
  flood: "#ef4444",
};

export function FloodMap({ viaBackend = false }: FloodMapProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const [gauges, setGauges] = useState<GaugeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GaugeRow | null>(null);

  useEffect(() => {
    let alive = true;
    const backendUrl = `${getApiBaseUrl().replace(/\/$/, "")}/floods/gauges?state=ca`;
    const primaryUrl = viaBackend ? backendUrl : USGS_URL;

    async function load(url: string): Promise<USGSWaterResponse> {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as USGSWaterResponse;
    }

    (async () => {
      try {
        const j = await load(primaryUrl);
        if (!alive) return;
        const rows = parseTimeSeries(j).slice(0, 200);
        setGauges(rows);
      } catch (e: unknown) {
        if (viaBackend) {
          try {
            const j = await load(USGS_URL);
            if (!alive) return;
            const rows = parseTimeSeries(j).slice(0, 200);
            setGauges(rows);
            return;
          } catch (fallbackErr) {
            if (!alive) return;
            setError(fallbackErr instanceof Error ? fallbackErr.message : "fetch failed");
            return;
          }
        }
        if (!alive) return;
        setError(e instanceof Error ? e.message : "fetch failed");
      }
    })();

    return () => {
      alive = false;
    };
  }, [viaBackend]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !gauges) return;
    const map = L.map(containerRef.current, {
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: false,
    }).setView([37.6, -120.0], 6);
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      { subdomains: "abcd", maxZoom: 19 },
    ).addTo(map);
    mapRef.current = map;

    const markers: LMarker[] = [];
    gauges.forEach((g) => {
      if (g.latestValue === null) return;
      const color = BAND_COLOR[stageBand(g.latestValue)];
      const r = 6;
      const html = `<div style="width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 6px ${color}aa;"></div>`;
      const m = L.marker([g.lat, g.lon], {
        icon: L.divIcon({
          html,
          className: "",
          iconSize: [r * 2, r * 2],
          iconAnchor: [r, r],
        }),
      });
      m.on("click", () => setSelected(g));
      m.addTo(map);
      markers.push(m);
    });
    return () => {
      markers.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
  }, [gauges]);

  return (
    <div className="relative h-full w-full bg-background">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      {!gauges && !error && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <div className="space-y-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
            <div className="text-xs text-muted-foreground">Pulling USGS NWIS gauge data…</div>
          </div>
        </div>
      )}
      {error && (
        <Card className="absolute left-4 top-4 z-[401] w-72 p-3">
          <div className="text-xs font-medium text-destructive">USGS feed unavailable</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{error}</div>
        </Card>
      )}
      {gauges && (
        <Card className="absolute right-4 top-4 z-[401] w-[280px] gap-0 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              USGS NWIS · CA · stage 00065
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {gauges.length}
            </Badge>
          </div>
          <ScrollArea className="mt-2 h-[260px] pr-2">
            <ul className="space-y-1.5">
              {gauges
                .slice()
                .sort((a, b) => (b.latestValue ?? 0) - (a.latestValue ?? 0))
                .slice(0, 60)
                .map((g) => (
                  <li key={g.siteCode}>
                    <button
                      type="button"
                      onClick={() => setSelected(g)}
                      className="w-full rounded-md border border-transparent px-2 py-1.5 text-left text-xs transition hover:border-border hover:bg-muted"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: BAND_COLOR[stageBand(g.latestValue ?? 0)],
                          }}
                        />
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {g.siteCode}
                        </span>
                        <span className="ml-auto font-mono font-semibold">
                          {(g.latestValue ?? 0).toFixed(2)} {g.unit}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {g.siteName}
                      </div>
                    </button>
                  </li>
                ))}
            </ul>
          </ScrollArea>
        </Card>
      )}
      {selected && (
        <Card className="absolute bottom-4 left-4 z-[401] w-[420px] p-4">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: BAND_COLOR[stageBand(selected.latestValue ?? 0)] }}
            />
            <span className="font-mono text-sm font-semibold">{selected.siteCode}</span>
            <Badge variant="secondary" className="text-[10px] uppercase">
              {stageBand(selected.latestValue ?? 0)}
            </Badge>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <div className="mt-1 truncate text-sm">{selected.siteName}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Latest: {selected.latestValue?.toFixed(2)} {selected.unit} ·{" "}
            {selected.latestTime ? new Date(selected.latestTime).toLocaleString() : "n/a"}
          </div>
          <div className="mt-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Forecast — quantile bands (p10 / p50 / p90)
            </div>
            <div className="grid grid-cols-3 gap-2">
              {quantileForecast(selected.values).map((q) => (
                <div
                  key={q.horizonHours}
                  className="rounded-md border border-border bg-muted/40 p-2 text-center"
                >
                  <div className="font-mono text-[10px] uppercase text-muted-foreground">
                    +{q.horizonHours}h
                  </div>
                  <div className="mt-0.5 font-mono text-xs font-semibold">{q.q50.toFixed(2)}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    [{q.q10.toFixed(2)}–{q.q90.toFixed(2)}]
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 text-[10px] text-muted-foreground">
            Persistence + observed-slope extrapolation; quantile-band shape mirrors the EA-LSTM
            head in <code className="text-foreground">ml/models/flood_ealstm.py</code>. ONNX
            inference replaces this when trained weights ship (CAMELS + USGS NWIS historic).
          </div>
        </Card>
      )}
    </div>
  );
}
