"use client";

import { useMemo, useState, useEffect } from "react";
import {
  Flame,
  AlertTriangle,
  Radio,
  Radar,
  CircleDot,
  ChevronRight,
  Clock,
  MapPin,
  Wind,
  Truck,
  CheckCircle2,
  Search,
  Command as CommandIcon,
  Send,
  X,
  Newspaper,
  MessageSquare,
  ShieldOff,
  Building2,
  ShieldAlert,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FIXTURE_INCIDENTS,
  statusColorClass,
  statusLabel,
  type FixtureIncident,
  type VerificationStatus,
} from "@/lib/fixtures";
import { cn } from "@/lib/utils";
import { LeafletMap } from "@/components/map/MapContainer";
import { IntelPanel } from "@/components/console/IntelPanel";

// Render the static ageMinutes from the fixture rather than recomputing
// against Date.now(), so server and client render the same string and we
// don't trip a hydration mismatch.
function formatAge(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CONUS = { minLon: -125, maxLon: -66, minLat: 24, maxLat: 50 };

function project(lat: number, lon: number) {
  const x = ((lon - CONUS.minLon) / (CONUS.maxLon - CONUS.minLon)) * 100;
  const y = (1 - (lat - CONUS.minLat) / (CONUS.maxLat - CONUS.minLat)) * 100;
  return { x, y };
}

function hotspotColor(s: VerificationStatus): string {
  switch (s) {
    case "EMERGING":
      return "#f97316";
    case "CREWS_ACTIVE":
      return "#10b981";
    case "UNREPORTED":
      return "#a1a1aa";
    case "KNOWN_PRESCRIBED":
      return "#3b82f6";
    case "LIKELY_INDUSTRIAL":
      return "#a855f7";
  }
}

export default function ConsolePage() {
  const [selectedId, setSelectedId] = useState<string | null>(FIXTURE_INCIDENTS[0]?.id ?? null);
  const [filter, setFilter] = useState<"all" | "active" | "emerging">("active");
  const [search, setSearch] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    let list = FIXTURE_INCIDENTS;
    if (filter === "active") {
      list = list.filter(
        (i) =>
          i.verification === "EMERGING" ||
          i.verification === "CREWS_ACTIVE" ||
          i.verification === "UNREPORTED",
      );
    } else if (filter === "emerging") {
      list = list.filter((i) => i.verification === "EMERGING");
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.shortId.toLowerCase().includes(q) ||
          i.county.toLowerCase().includes(q) ||
          i.neighborhood.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => a.ageMinutes - b.ageMinutes);
  }, [filter, search]);

  const selected = FIXTURE_INCIDENTS.find((i) => i.id === selectedId) ?? null;

  const activeCount = FIXTURE_INCIDENTS.filter(
    (i) => i.verification === "EMERGING" || i.verification === "CREWS_ACTIVE",
  ).length;
  const emergingCount = FIXTURE_INCIDENTS.filter((i) => i.verification === "EMERGING").length;

  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card/40 px-5 py-3">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary animate-flicker" aria-hidden />
          <h1 className="text-base font-semibold tracking-tight">SENTRY Dispatcher</h1>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
            v0 · live fixtures
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <Stat label="Active" value={activeCount} tone="emerald" icon={<CircleDot className="h-3.5 w-3.5" />} />
          <Stat
            label="Emerging"
            value={emergingCount}
            tone="orange"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
          />
          <Stat label="24h total" value={FIXTURE_INCIDENTS.length} tone="zinc" icon={<Radar className="h-3.5 w-3.5" />} />
          <span className="ml-2 inline-flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-muted-foreground">
            <CommandIcon className="h-3.5 w-3.5" /> K
          </span>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[1fr_420px] overflow-hidden">
        <MapPanel incidents={FIXTURE_INCIDENTS} selectedId={selectedId} onSelect={setSelectedId} />
        <aside className="flex flex-col overflow-hidden border-l border-border bg-card/20">
          <QueueHeader
            filter={filter}
            onFilter={setFilter}
            search={search}
            onSearch={setSearch}
            count={filtered.length}
          />
          <Queue incidents={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
      </div>

      <AnimatePresence>
        {selected && <DetailSheet incident={selected} onClose={() => setSelectedId(null)} />}
      </AnimatePresence>
    </main>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "emerald" | "orange" | "zinc";
  icon: React.ReactNode;
}) {
  const toneClass =
    tone === "emerald" ? "text-emerald-400" : tone === "orange" ? "text-orange-400" : "text-zinc-300";
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1">
      <span className={toneClass}>{icon}</span>
      <span className="font-medium">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function MapPanel({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: FixtureIncident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="relative overflow-hidden bg-zinc-950" aria-label="Live map">
      <LeafletMap
        incidents={incidents.map((i) => ({
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
          stations: i.stations.map((s) => ({
            id: s.id,
            name: s.name,
            etaMinutes: s.etaMinutes,
            lat: s.lat ?? 0,
            lon: s.lon ?? 0,
          })).filter((s) => s.lat !== 0),
          selected: i.id === selectedId,
        }))}
        onIncidentClick={onSelect}
        height="100%"
        className="absolute inset-0 h-full w-full"
      />

      {/* Status legend — bottom-left to stay clear of the basemap + layer
          toggles that the LeafletMap renders at top-left. */}
      <div className="absolute bottom-4 left-3 rounded-md border border-border bg-card/80 p-3 backdrop-blur">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Hotspots</div>
        <div className="mt-2 flex flex-col gap-1.5 text-xs">
          {(
            [
              ["EMERGING", "Emerging"],
              ["CREWS_ACTIVE", "Crews active"],
              ["UNREPORTED", "Unreported"],
              ["KNOWN_PRESCRIBED", "Prescribed"],
              ["LIKELY_INDUSTRIAL", "Industrial"],
            ] as [VerificationStatus, string][]
          ).map(([k, label]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: hotspotColor(k) }} />
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function QueueHeader({
  filter,
  onFilter,
  search,
  onSearch,
  count,
}: {
  filter: "all" | "active" | "emerging";
  onFilter: (f: "all" | "active" | "emerging") => void;
  search: string;
  onSearch: (s: string) => void;
  count: number;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-card/40 px-3 py-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Incident queue</h2>
        <span className="text-xs text-muted-foreground">{count} shown</span>
      </div>
      <div className="mt-2 flex gap-1">
        {(["active", "emerging", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => onFilter(f)}
            className={cn(
              "rounded px-2 py-1 text-xs capitalize transition",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded border border-border bg-background px-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search ID, county, neighborhood…"
          className="w-full bg-transparent py-1.5 text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

function Queue({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: FixtureIncident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex-1 overflow-auto">
      <ul className="divide-y divide-border">
        {incidents.map((i) => (
          <motion.li
            key={i.id}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => onSelect(i.id)}
            className={cn(
              "cursor-pointer px-3 py-3 transition hover:bg-card/60",
              selectedId === i.id && "bg-card/80",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-xs font-semibold">{i.shortId}</span>
              <span
                className={cn(
                  "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  statusColorClass(i.verification),
                )}
              >
                {statusLabel(i.verification)}
              </span>
            </div>
            <div className="mt-1 text-sm">
              {i.neighborhood}, {i.county} {i.state}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {formatAge(i.ageMinutes)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Wind className="h-3 w-3" /> {i.windSpeedMs.toFixed(1)} m/s @ {Math.round(i.windDirDeg)}°
              </span>
              <span>FRP {i.fireRadiativePower.toFixed(0)} MW</span>
              <span className="capitalize">conf · {i.firmsConfidence}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                {i.stations[0] ? (
                  <>
                    nearest <span className="text-foreground">{i.stations[0].name.split(" ").slice(0, 3).join(" ")}</span> ·{" "}
                    {i.stations[0].etaMinutes} min
                  </>
                ) : (
                  <span className="italic">no stations in range</span>
                )}
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </motion.li>
        ))}
        {incidents.length === 0 && (
          <li className="px-4 py-12 text-center text-sm text-muted-foreground">No incidents match.</li>
        )}
      </ul>
    </div>
  );
}

function DetailSheet({ incident, onClose }: { incident: FixtureIncident; onClose: () => void }) {
  const dispatchable = incident.verification === "EMERGING" || incident.verification === "UNREPORTED";

  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 28, stiffness: 260 }}
      className="absolute right-0 top-0 z-30 flex h-full w-[520px] flex-col border-l border-border bg-background shadow-2xl"
      role="dialog"
      aria-label={`Incident ${incident.shortId} detail`}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <div className="font-mono text-sm font-semibold">{incident.shortId}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {incident.neighborhood}, {incident.county} {incident.state} ·{" "}
            {formatAge(incident.ageMinutes)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
              statusColorClass(incident.verification),
            )}
          >
            {statusLabel(incident.verification)}
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
            aria-label="Close detail"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-auto px-5 py-4">
        <Section icon={<ShieldAlert className="h-3.5 w-3.5" />} title="Intelligence — live cross-check">
          <IntelPanel incidentId={incident.id} />
        </Section>

        <Section icon={<MapPin className="h-3.5 w-3.5" />} title="Hotspot">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <Field label="Lat" value={incident.lat.toFixed(4)} />
            <Field label="Lon" value={incident.lon.toFixed(4)} />
            <Field label="FIRMS confidence" value={incident.firmsConfidence} capitalize />
            <Field label="Bright TI4" value={`${incident.brightTi4.toFixed(1)} K`} />
            <Field label="FRP" value={`${incident.fireRadiativePower.toFixed(0)} MW`} />
            <Field label="Age" value={`${incident.ageMinutes} min`} />
          </div>
        </Section>

        <Section icon={<Wind className="h-3.5 w-3.5" />} title="Wind & predicted spread">
          <div className="flex items-center gap-4">
            <WindRose dirDeg={incident.windDirDeg} speedMs={incident.windSpeedMs} />
            <div className="text-xs">
              <div className="font-medium">
                {incident.windSpeedMs.toFixed(1)} m/s @ {Math.round(incident.windDirDeg)}° (from)
              </div>
              <div className="mt-0.5 text-muted-foreground">HRRR cycle · 60 min freshness</div>
            </div>
          </div>
          {incident.predictedSpread.length > 0 ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {incident.predictedSpread.map((p) => (
                <div key={p.horizonMin} className="rounded border border-border bg-card px-2 py-2 text-xs">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    +{p.horizonMin === 60 ? "1h" : p.horizonMin === 360 ? "6h" : "24h"} · 50% band
                  </div>
                  <div className="mt-1 font-medium">{p.areaAcres.toLocaleString()} acres</div>
                  <div className="text-[10px] text-muted-foreground">bearing {p.bearingDeg}°</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Spread suppressed — verification status doesn&apos;t warrant prediction.
            </div>
          )}
        </Section>

        <Section
          icon={
            incident.verificationSources[0]?.kind === "registry" ? (
              <ShieldOff className="h-3.5 w-3.5" />
            ) : (
              <Newspaper className="h-3.5 w-3.5" />
            )
          }
          title="Verification sources"
        >
          {incident.verificationSources.length === 0 ? (
            <div className="rounded border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              No corroborating signals in the last 60 minutes.
            </div>
          ) : (
            <ul className="space-y-2">
              {incident.verificationSources.map((s, idx) => (
                <li key={idx} className="rounded border border-border bg-card/60 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {sourceIcon(s.kind)} {s.kind} · {s.source}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{s.ageMinutes} min ago</span>
                  </div>
                  <div className="mt-1 font-medium">{s.title}</div>
                  <div className="mt-0.5 text-muted-foreground">{s.snippet}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section icon={<Truck className="h-3.5 w-3.5" />} title="Nearest stations">
          {incident.stations.length === 0 ? (
            <div className="rounded border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
              No stations within range.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {incident.stations.map((s, idx) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded border border-border bg-card/60 px-3 py-2 text-xs"
                >
                  <div>
                    <div className="font-medium">
                      {idx === 0 && <span className="mr-1.5 text-emerald-400">●</span>}
                      {s.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{s.agency}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{s.etaMinutes} min</div>
                    <div className="text-[11px] text-muted-foreground">{s.distanceKm.toFixed(1)} km</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="shrink-0 border-t border-border bg-card/40 px-5 py-3">
        <button
          disabled={!dispatchable}
          className={cn(
            "inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition",
            dispatchable
              ? "bg-primary text-primary-foreground hover:bg-orange-500"
              : "cursor-not-allowed bg-card text-muted-foreground",
          )}
        >
          <Send className="h-4 w-4" />
          {dispatchable
            ? `Dispatch ${incident.stations[0]?.name.split(" ").slice(0, 3).join(" ") ?? "nearest"}`
            : "Dispatch suppressed for this verification status"}
        </button>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> human-in-the-loop · audit logged
          </span>
          <span>
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono text-[10px]">D</kbd> dispatch ·{" "}
            <kbd className="rounded border border-border bg-card px-1 py-0.5 font-mono text-[10px]">Esc</kbd> close
          </span>
        </div>
      </div>
    </motion.aside>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-medium", capitalize && "capitalize")}>{value}</div>
    </div>
  );
}

function WindRose({ dirDeg, speedMs }: { dirDeg: number; speedMs: number }) {
  const angle = ((dirDeg - 90) * Math.PI) / 180;
  const r = 28;
  const x = 36 + r * Math.cos(angle);
  const y = 36 + r * Math.sin(angle);
  const opp = ((dirDeg + 90) * Math.PI) / 180;
  const tx = 36 + r * Math.cos(opp);
  const ty = 36 + r * Math.sin(opp);

  return (
    <svg width={72} height={72} viewBox="0 0 72 72" className="shrink-0">
      <circle cx={36} cy={36} r={32} fill="none" stroke="rgb(63 63 70)" strokeWidth="1" />
      <circle cx={36} cy={36} r={20} fill="none" stroke="rgb(39 39 42)" strokeWidth="0.6" strokeDasharray="2 2" />
      {["N", "E", "S", "W"].map((n, i) => {
        const a = ((i * 90 - 90) * Math.PI) / 180;
        return (
          <text
            key={n}
            x={36 + 30 * Math.cos(a)}
            y={36 + 30 * Math.sin(a) + 3}
            fontSize="8"
            textAnchor="middle"
            fill="rgb(113 113 122)"
          >
            {n}
          </text>
        );
      })}
      <line x1={36} y1={36} x2={x} y2={y} stroke="#f97316" strokeWidth="2" strokeLinecap="round" />
      <line x1={36} y1={36} x2={tx} y2={ty} stroke="rgb(63 63 70)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={36} cy={36} r="2.5" fill="#f97316" />
      <text x={36} y={68} fontSize="7" textAnchor="middle" fill="rgb(161 161 170)">
        {speedMs.toFixed(1)} m/s
      </text>
    </svg>
  );
}

function sourceIcon(kind: "news" | "social" | "scanner" | "registry") {
  switch (kind) {
    case "news":
      return <Newspaper className="h-3 w-3" />;
    case "social":
      return <MessageSquare className="h-3 w-3" />;
    case "scanner":
      return <Radio className="h-3 w-3" />;
    case "registry":
      return <Building2 className="h-3 w-3" />;
  }
}
