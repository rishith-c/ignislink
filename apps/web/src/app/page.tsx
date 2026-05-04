"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Flame, Search, MapPin, Wind, AlertCircle, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { FIXTURE_INCIDENTS, type FixtureIncident } from "@/lib/fixtures";
import { LeafletMap } from "@/components/map/MapContainer";
import { cn } from "@/lib/utils";

// Use the static ageMinutes from the fixture to avoid hydration drift —
// otherwise server SSRs at T and client hydrates at T+Δ, producing different
// "Xm ago" strings.
function formatAge(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Public Awareness Map — read-only civilian view per PRD §4.2.
// Shows ONLY EMERGING + CREWS_ACTIVE (UNREPORTED, KNOWN_PRESCRIBED, LIKELY_INDUSTRIAL
// suppressed for civilian audience).
const PUBLIC_INCIDENTS = FIXTURE_INCIDENTS.filter(
  (i) => i.verification === "EMERGING" || i.verification === "CREWS_ACTIVE",
);

const CONUS = { minLon: -125, maxLon: -66, minLat: 24, maxLat: 50 };
function project(lat: number, lon: number) {
  return {
    x: ((lon - CONUS.minLon) / (CONUS.maxLon - CONUS.minLon)) * 100,
    y: (1 - (lat - CONUS.minLat) / (CONUS.maxLat - CONUS.minLat)) * 100,
  };
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [center, setCenter] = useState<{ lat: number; lon: number; label: string } | null>(null);

  const sortedNearMe = useMemo(() => {
    if (!center) return PUBLIC_INCIDENTS;
    return [...PUBLIC_INCIDENTS]
      .map((i) => ({ ...i, distKm: distanceKm(center.lat, center.lon, i.lat, i.lon) }))
      .sort((a, b) => a.distKm - b.distKm);
  }, [center]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = PUBLIC_INCIDENTS.find(
      (i) =>
        i.county.toLowerCase().includes(q) ||
        i.neighborhood.toLowerCase().includes(q) ||
        i.state.toLowerCase() === q,
    );
    if (match) {
      setCenter({ lat: match.lat, lon: match.lon, label: `${match.neighborhood}, ${match.state}` });
    }
  }

  function handleGeolocate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "Your location",
        });
      },
      () => {
        setCenter({ lat: 36.7783, lon: -119.4179, label: "California (default)" });
      },
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card/40 backdrop-blur">
        <div className="container mx-auto flex items-center gap-3 px-4 py-3">
          <Flame className="h-6 w-6 text-primary animate-flicker" aria-hidden />
          <div>
            <h1 className="text-base font-semibold tracking-tight">SENTRY</h1>
            <p className="text-[11px] text-muted-foreground">
              Public situational awareness · verified active fires only
            </p>
          </div>
          <Link
            href="/console"
            className="ml-auto rounded border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            Dispatcher console →
          </Link>
        </div>
      </header>

      <section className="container mx-auto grid gap-6 px-4 py-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-balance text-3xl font-semibold leading-tight">
              Active wildfire detections, last 24 hours
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {PUBLIC_INCIDENTS.length} verified active incident{PUBLIC_INCIDENTS.length === 1 ? "" : "s"}{" "}
              shown. Satellite-only unconfirmed hotspots, prescribed burns, and registered industrial
              flares are not displayed on the public map.
            </p>
          </div>

          <form
            onSubmit={handleSearch}
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
          >
            <div className="flex flex-1 items-center gap-2 rounded border border-border bg-background px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search county, neighborhood, or state code (CA, OR, NV)…"
                className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <button
              type="submit"
              className="rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-orange-500"
            >
              Find
            </button>
            <button
              type="button"
              onClick={handleGeolocate}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-border bg-card px-3 py-2 text-sm hover:bg-card/80"
            >
              <MapPin className="h-3.5 w-3.5" /> Near me
            </button>
          </form>

          <div className="relative">
            <LeafletMap
              incidents={PUBLIC_INCIDENTS.map((i) => ({
                id: i.id,
                shortId: i.shortId,
                lat: i.lat,
                lon: i.lon,
                status: i.verification,
                windDirDeg: i.windDirDeg,
                windSpeedMs: i.windSpeedMs,
                predictedSpread: i.predictedSpread.map((p) => ({
                  horizonMin: p.horizonMin,
                  areaAcres: p.areaAcres,
                  bearingDeg: p.bearingDeg,
                })),
              }))}
              publicOnly
              initialCenter={center ? [center.lat, center.lon] : undefined}
              initialZoom={center ? 7 : 5}
              height={520}
            />
            <div className="pointer-events-none absolute left-3 top-3 z-[402] rounded border border-border bg-card/80 px-2.5 py-1.5 text-[10px] backdrop-blur">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-orange-500" /> Reported by news outlets
              </div>
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> Crews on scene
              </div>
              <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                <span className="inline-block h-2 w-2 animate-flicker rounded-full bg-orange-500" /> Embers drift live wind × fuel
              </div>
            </div>
          </div>

          <div className="rounded border border-orange-900/30 bg-orange-950/20 px-3 py-2 text-xs text-orange-200/80">
            <strong>SENTRY is a situational tool, not an evacuation authority.</strong> For
            evacuation orders, follow your local Authority Having Jurisdiction (AHJ) — Cal Fire, county
            OES, or municipal fire department.
          </div>
        </div>

        <aside className="space-y-3">
          <h3 className="text-sm font-semibold">
            {center ? `Closest to ${center.label}` : "Recent incidents"}
          </h3>
          <ul className="space-y-2">
            {sortedNearMe.map((i) => (
              <PublicIncidentCard key={i.id} incident={i} distKm={(i as FixtureIncident & { distKm?: number }).distKm} />
            ))}
          </ul>
          <div className="rounded border border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
            <div className="mb-1 font-medium text-foreground">What you&apos;re seeing</div>
            Each dot represents a satellite-detected hotspot that has been corroborated by news
            reports or scanner traffic in the last 60 minutes. Locations are rounded for civilian
            view — exact coordinates and station-level detail are restricted to authorized
            dispatchers.
          </div>
        </aside>
      </section>

      <footer className="border-t border-border">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground">
          <span>
            Data sources: NASA FIRMS · NOAA HRRR · USGS LANDFIRE · Open-Meteo · Mapbox
          </span>
          <span suppressHydrationWarning>v0 · feed live · 1m ago</span>
        </div>
      </footer>
    </main>
  );
}

function PublicIncidentCard({
  incident,
  distKm,
}: {
  incident: FixtureIncident;
  distKm?: number;
}) {
  const verifLabel =
    incident.verification === "EMERGING" ? "Reported by news outlets" : "Crews on scene";
  const dot = incident.verification === "EMERGING" ? "bg-orange-500" : "bg-emerald-500";
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded border border-border bg-card/60 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className={cn("inline-block h-2 w-2 rounded-full", dot)} />
          {verifLabel}
        </span>
        {typeof distKm === "number" && (
          <span className="text-[10px] text-muted-foreground">{distKm.toFixed(0)} km away</span>
        )}
      </div>
      <div className="mt-1.5 text-sm font-medium">
        {incident.neighborhood}, {incident.county} {incident.state}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> {formatAge(incident.ageMinutes)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Wind className="h-3 w-3" /> {incident.windSpeedMs.toFixed(1)} m/s @{" "}
          {Math.round(incident.windDirDeg)}°
        </span>
        {incident.predictedSpread.find((p) => p.horizonMin === 360) && (
          <span className="inline-flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> ~
            {incident.predictedSpread.find((p) => p.horizonMin === 360)!.areaAcres.toLocaleString()}{" "}
            acres @ 6 h
          </span>
        )}
      </div>
    </motion.li>
  );
}
