"use client";

// Right-sidebar list that swaps into the dispatcher console when the
// hazard switcher is set to "flood". Pulls live USGS NWIS gauge stage
// for California, ranks by stage band (low / normal / elevated / flood).

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface USGSValue {
  value: string;
  dateTime: string;
}
interface USGSTimeSeries {
  sourceInfo: {
    siteName: string;
    siteCode: { value: string }[];
    geoLocation: { geogLocation: { latitude: number; longitude: number } };
  };
  variable: { unit: { unitCode: string } };
  values: { value: USGSValue[] }[];
}
interface USGSResponse {
  value: { timeSeries: USGSTimeSeries[] };
}

interface GaugeRow {
  siteCode: string;
  siteName: string;
  unit: string;
  latestValue: number;
  latestTime: string;
  trendPerHour: number;
}

const URL =
  `https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd=ca` +
  `&parameterCd=00065&siteStatus=active&period=PT24H`;

function parse(data: USGSResponse): GaugeRow[] {
  const rows: GaugeRow[] = [];
  for (const ts of data.value.timeSeries) {
    const code = ts.sourceInfo.siteCode[0]?.value;
    if (!code) continue;
    const block = ts.values[0];
    if (!block) continue;
    const values = block.value
      .map((v) => ({ dateTime: v.dateTime, value: parseFloat(v.value) }))
      .filter((v) => Number.isFinite(v.value) && v.value !== -999999);
    if (values.length === 0) continue;
    const last = values[values.length - 1]!;
    const first = values[0]!;
    const hours = Math.max(
      1,
      (new Date(last.dateTime).getTime() - new Date(first.dateTime).getTime()) / 3.6e6,
    );
    rows.push({
      siteCode: code,
      siteName: ts.sourceInfo.siteName,
      unit: ts.variable.unit.unitCode,
      latestValue: last.value,
      latestTime: last.dateTime,
      trendPerHour: (last.value - first.value) / hours,
    });
  }
  return rows;
}

function stageBand(stageFt: number): { label: string; color: string } {
  if (stageFt < 1) return { label: "low", color: "#64748b" };
  if (stageFt < 5) return { label: "normal", color: "#22c55e" };
  if (stageFt < 10) return { label: "elevated", color: "#eab308" };
  return { label: "flood", color: "#ef4444" };
}

export function FloodSidebar() {
  const [gauges, setGauges] = useState<GaugeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<USGSResponse>;
      })
      .then((j) => {
        if (!alive) return;
        const rows = parse(j).sort((a, b) => b.latestValue - a.latestValue).slice(0, 200);
        setGauges(rows);
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
          <h2 className="text-sm font-semibold tracking-tight">Stream gauges</h2>
          {gauges && (
            <Badge variant="secondary" className="text-[10px]">
              {gauges.length} active
            </Badge>
          )}
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          USGS NWIS · California · parameter 00065 (gauge height, ft) · sorted by latest stage
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="divide-y divide-border">
          {!gauges && !error && (
            <li className="space-y-2 p-4">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </li>
          )}
          {error && (
            <li className="p-4 text-xs text-destructive">USGS feed unavailable — {error}</li>
          )}
          {gauges?.map((g) => {
            const band = stageBand(g.latestValue);
            const trendUp = g.trendPerHour > 0.02;
            const trendDown = g.trendPerHour < -0.02;
            return (
              <li key={g.siteCode} className="px-4 py-3 transition hover:bg-accent/40">
                <div className="flex items-start gap-3">
                  <span
                    className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase text-white"
                    style={{ backgroundColor: band.color, boxShadow: `0 0 6px ${band.color}99` }}
                  >
                    {band.label.slice(0, 4)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-foreground">
                      {g.siteName}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <span>{g.siteCode}</span>
                      <span>·</span>
                      <span>
                        {g.latestValue.toFixed(2)} {g.unit}
                      </span>
                      <span>·</span>
                      <span className={trendUp ? "text-amber-400" : trendDown ? "text-emerald-400" : ""}>
                        {trendUp ? "↑" : trendDown ? "↓" : "·"}{" "}
                        {Math.abs(g.trendPerHour).toFixed(3)} ft/h
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
