"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Command as CommandIcon,
  Flame,
  Gauge,
  Layers3,
  MapPin,
  MessageSquare,
  Navigation,
  Newspaper,
  Radio,
  Radar,
  Route,
  Search,
  Send,
  ShieldAlert,
  ShieldOff,
  Truck,
  Wind,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  FIXTURE_INCIDENTS,
  statusColorClass,
  statusLabel,
  type FixtureIncident,
  type VerificationStatus,
} from "@/lib/fixtures";
import { postDispatch, isOk } from "@/lib/api/client";
import { useDetectionsStream, type SseStatus } from "@/lib/api/sse";
import { cn } from "@/lib/utils";
import { bboxFromPoints } from "@/lib/firms/project";
import { LeafletMap } from "@/components/map/MapContainer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import dynamic from "next/dynamic";
import { computeBbox } from "@/lib/geo/bbox";

// EarthquakeMap + FloodMap import leaflet at module top-level — leaflet
// touches `window` so they must be SSR-disabled like FireSimulator3D.
const EarthquakeMap = dynamic(
  () => import("@/components/map/EarthquakeMap").then((m) => m.EarthquakeMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-background text-xs text-muted-foreground">
        loading earthquake map…
      </div>
    ),
  },
);
const FloodMap = dynamic(
  () => import("@/components/map/FloodMap").then((m) => m.FloodMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-background text-xs text-muted-foreground">
        loading flood map…
      </div>
    ),
  },
);

// 3D fire visualizer is browser-only (three.js); load it client-side.
// We use the *Live* wrapper which fetches real DEM (AWS Terrain Tiles) +
// a 5x5 Open-Meteo spatial wind grid via TanStack Query and forwards the
// rest of the props to FireSimulator3D unchanged. Any fetch failure
// degrades gracefully back to the procedural terrain + uniform wind.
const FireSimulator3DLive = dynamic(
  () =>
    import("@/components/map/FireSimulator3DLive").then((m) => m.FireSimulator3DLive),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-black text-xs text-zinc-500">
        loading 3d…
      </div>
    ),
  },
);

// ONNX-aware 3D scene. Self-contained sibling of FireSimulator3D that runs
// `/fire-spread-smoke.onnx` in a Web Worker every ~500ms and blends its
// t+6h burn-probability raster onto the terrain. The "3D + AI" tab below
// switches to this component.
const FireSimulator3DOnnxOverlay = dynamic(
  () =>
    import("@/components/map/FireSimulator3DOnnxOverlay").then(
      (m) => m.FireSimulator3DOnnxOverlay,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-black text-xs text-zinc-500">
        loading 3d + AI…
      </div>
    ),
  },
);

type HazardKind = "fire" | "earthquake" | "flood";
// 3D + AI runs the in-browser ONNX U-Net+ConvLSTM model and blends its p6h
// burn-probability raster onto the terrain. Falls back to CA-only when the
// /fire-spread-smoke.onnx artifact isn't present in the build.
type ViewMode = "2d" | "3d" | "3d-ai";
import { IntelPanel } from "@/components/console/IntelPanel";
import { EarthquakeSidebar } from "@/components/console/EarthquakeSidebar";
import { FloodSidebar } from "@/components/console/FloodSidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type EnvironmentalInputs = {
  source: "open-meteo" | "fixture-fallback";
  sampledAt: string;
  humidityPct: number | null;
  temperatureC: number | null;
  precip10dMm: number | null;
  fuelDryness: number | null;
};

type ConsoleIncident = Omit<FixtureIncident, "observedAt"> & {
  observedAt: string | Date;
  environmental?: EnvironmentalInputs;
};

function withFallbackEnvironmental(incident: FixtureIncident): ConsoleIncident {
  return {
    ...incident,
    environmental: {
      source: "fixture-fallback",
      sampledAt: incident.observedAt.toISOString(),
      humidityPct: null,
      temperatureC: null,
      precip10dMm: null,
      fuelDryness: null,
    },
  };
}

// Render the static ageMinutes from the fixture rather than recomputing
// against Date.now(), so server and client render the same string and we
// don't trip a hydration mismatch.
function formatAge(mins: number): string {
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function hotspotColor(s: VerificationStatus): string {
  switch (s) {
    case "EMERGING":
      return "#ff6b35";
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
  const [incidents, setIncidents] = useState<ConsoleIncident[]>(() =>
    FIXTURE_INCIDENTS.map(withFallbackEnvironmental),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "emerging">("active");
  const [search, setSearch] = useState("");
  // Hazard state lives at the top so both MapPanel AND the right-sidebar can
  // react to it. When hazard ≠ "fire" the sidebar swaps the fire incident
  // queue for a hazard-specific list.
  const [hazard, setHazard] = useState<HazardKind>("fire");
  const [view, setView] = useState<ViewMode>("2d");

  // 30s poll fallback — even when SSE is open we keep polling so the queue
  // re-syncs after SSE reconnects. The /api/incidents proxy itself prefers
  // the FastAPI backend and falls back to fixtures when it's down.
  useEffect(() => {
    let cancelled = false;
    function pull() {
      fetch("/api/incidents", { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ incidents: ConsoleIncident[] }>;
        })
        .then((json) => {
          if (!cancelled && Array.isArray(json.incidents) && json.incidents.length > 0) {
            setIncidents(json.incidents);
          }
        })
        .catch(() => {
          if (!cancelled) setIncidents(FIXTURE_INCIDENTS.map(withFallbackEnvironmental));
        });
    }
    pull();
    const interval = setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Live append of new detections via SSE. We merge by id so the same
  // detection can update in place rather than producing a duplicate.
  const onSseEvent = useCallback((event: { detection?: Record<string, unknown> }) => {
    if (!event.detection) return;
    const det = event.detection as Partial<ConsoleIncident> & { id?: string };
    if (!det.id) return;
    setIncidents((prev) => {
      const existing = prev.findIndex((i) => i.id === det.id);
      const merged: ConsoleIncident = {
        ...(existing >= 0 ? prev[existing]! : FIXTURE_INCIDENTS[0]!),
        ...(det as ConsoleIncident),
      };
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = merged;
        return next;
      }
      // Prepend so the Framer-Motion entry animation runs at the top of the
      // queue. The QueueItem already has a sentry-file-in stagger.
      return [merged, ...prev];
    });
  }, []);

  const { status: sseStatus } = useDetectionsStream({ onEvent: onSseEvent });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    let list = incidents;
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
  }, [filter, incidents, search]);

  const selected = incidents.find((i) => i.id === selectedId) ?? null;

  const activeCount = incidents.filter(
    (i) => i.verification === "EMERGING" || i.verification === "CREWS_ACTIVE",
  ).length;
  const emergingCount = incidents.filter((i) => i.verification === "EMERGING").length;
  const windSource = incidents.some((i) => i.environmental?.source === "open-meteo")
    ? "Open-Meteo wind"
    : "fixture fallback";

  return (
    <main className="sentry-bg text-foreground h-screen overflow-hidden p-0">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.34, 1.56, 0.64, 1] }}
        className="bg-[#060609]/82 flex h-full min-h-0 w-full flex-col overflow-hidden backdrop-blur-md"
      >
        <AppChrome
          activeCount={activeCount}
          emergingCount={emergingCount}
          totalCount={incidents.length}
          windSource={windSource}
          sseStatus={sseStatus}
        />

        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={69} minSize={60}>
            <MapPanel
              incidents={incidents}
              selectedId={selectedId}
              selected={selected}
              onSelect={setSelectedId}
              hazard={hazard}
              setHazard={setHazard}
              view={view}
              setView={setView}
            />
          </ResizablePanel>
          <ResizableHandle withHandle className="sentry-resize-handle border-0 bg-transparent" />
          <ResizablePanel defaultSize={31} minSize={23} maxSize={40}>
            <aside className="flex h-full min-h-0 flex-col border-l border-white/10">
              {hazard === "fire" ? (
                <>
                  <QueueHeader
                    filter={filter}
                    onFilter={setFilter}
                    search={search}
                    onSearch={setSearch}
                    count={filtered.length}
                  />
                  <Queue incidents={filtered} selectedId={selectedId} onSelect={setSelectedId} />
                </>
              ) : hazard === "earthquake" ? (
                <EarthquakeSidebar />
              ) : (
                <FloodSidebar />
              )}
            </aside>
          </ResizablePanel>
        </ResizablePanelGroup>
      </motion.div>

      {selected && <DetailSheet incident={selected} onClose={() => setSelectedId(null)} />}
    </main>
  );
}

function LivePill({ status }: { status: SseStatus }) {
  const tone =
    status === "open"
      ? { dot: "bg-emerald-400", text: "text-emerald-200", border: "border-emerald-300/40", label: "LIVE" }
      : status === "fallback"
        ? { dot: "bg-amber-400", text: "text-amber-200", border: "border-amber-300/40", label: "POLL" }
        : status === "connecting"
          ? { dot: "bg-zinc-400", text: "text-zinc-300", border: "border-zinc-300/30", label: "CONNECTING" }
          : { dot: "bg-rose-500", text: "text-rose-200", border: "border-rose-400/40", label: "OFFLINE" };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-black/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-md",
        tone.border,
        tone.text,
      )}
      aria-live="polite"
      aria-label={`stream ${status}`}
    >
      <span className={cn("sentry-live-dot h-1.5 w-1.5 rounded-full", tone.dot)} />
      {tone.label}
    </span>
  );
}

function AppChrome({
  activeCount,
  emergingCount,
  totalCount,
  windSource,
  sseStatus,
}: {
  activeCount: number;
  emergingCount: number;
  totalCount: number;
  windSource: string;
  sseStatus: SseStatus;
}) {
  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-white/10 bg-black/[0.28] px-5 backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-3">
        {/* Logo — concentric ring + dot flame, inspired by rishith-c/sentry's
            threat-band visual language. Not a sharp square. */}
        <span className="relative flex h-9 w-9 items-center justify-center" aria-hidden>
          <span className="absolute inset-0 rounded-full bg-primary/10 ring-1 ring-primary/40" />
          <span className="absolute inset-1 rounded-full bg-primary/15 ring-1 ring-primary/60" />
          <span className="absolute inset-[6px] rounded-full bg-primary text-primary-foreground shadow-[0_0_12px_hsl(var(--primary)/0.55)]" />
          <Flame className="relative h-4 w-4 text-primary-foreground" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold leading-none">SENTRY Dispatcher</h1>
            <Badge className="hidden border-white/10 bg-white/[0.08] text-[10px] font-medium text-zinc-200 shadow-none sm:inline-flex">
              Operations
            </Badge>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="sentry-live-dot h-1.5 w-1.5 rounded-full bg-[var(--sentry-orange)]" />
            <span>satellite detections · {windSource} · routing and dispatch queue</span>
          </div>
        </div>
      </div>

      <div className="ml-auto hidden items-center gap-2 lg:flex">
        <LivePill status={sseStatus} />
        <Stat label="Active" value={activeCount} tone="emerald" icon={<Activity />} />
        <Stat label="Emerging" value={emergingCount} tone="orange" icon={<AlertTriangle />} />
        <Stat label="24h Total" value={totalCount} tone="zinc" icon={<Radar />} />
      </div>
    </header>
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
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "orange"
        ? "text-[var(--sentry-orange-light)]"
        : "text-zinc-300";
  return (
    <div className="sentry-glass flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-xs">
      <span className={cn("flex [&_svg]:h-3.5 [&_svg]:w-3.5", toneClass)}>{icon}</span>
      <span className="font-semibold">{value}</span>
      <span className="text-zinc-400">{label}</span>
    </div>
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
    <div className="shrink-0 space-y-4 border-b border-white/10 bg-black/[0.12] p-4 backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Badge className="mb-2 gap-1.5 border-white/10 bg-white/[0.08] px-2 py-1 text-[11px] font-medium text-zinc-300 shadow-none">
            <Layers3 className="h-3.5 w-3.5 text-[var(--sentry-orange-light)]" />
            spread model inputs
          </Badge>
          <h2 className="text-xl font-semibold leading-tight">Incident queue</h2>
          <p className="mt-1 text-xs text-zinc-400">
            {count} visible from FIRMS, local intel and routing workers
          </p>
        </div>
        <Badge className="gap-1.5 border-orange-300/20 bg-orange-500/[0.12] text-xs font-medium text-orange-100 shadow-none">
          <span className="sentry-live-dot h-1.5 w-1.5 rounded-full bg-[var(--sentry-orange)]" />
          Live
        </Badge>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search ID, county, neighborhood..."
          className="h-10 rounded-[12px] border-white/10 bg-white/[0.07] pl-9 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-[var(--sentry-orange)]"
          aria-label="Search incidents"
        />
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-[12px] border border-white/10 bg-black/[0.18] p-1">
        {(["active", "emerging", "all"] as const).map((f) => (
          <Button
            key={f}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onFilter(f)}
            className={cn(
              "h-8 rounded-md text-xs capitalize text-muted-foreground hover:bg-muted hover:text-foreground",
              filter === f && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
            )}
          >
            {f}
          </Button>
        ))}
      </div>
    </div>
  );
}

function Queue({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: ConsoleIncident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <ul className="space-y-2.5 p-3">
        {incidents.map((incident, index) => (
          <QueueItem
            key={incident.id}
            incident={incident}
            selected={selectedId === incident.id}
            index={index}
            onSelect={onSelect}
          />
        ))}
        {incidents.length === 0 && (
          <li className="sentry-glass rounded-[14px] px-4 py-12 text-center text-sm text-zinc-400">
            No incidents match this filter.
          </li>
        )}
      </ul>
    </ScrollArea>
  );
}

function QueueItem({
  incident,
  selected,
  index,
  onSelect,
}: {
  incident: ConsoleIncident;
  selected: boolean;
  index: number;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <Button
        asChild
        variant="ghost"
        className={cn(
          "sentry-file-in sentry-pressable h-auto w-full whitespace-normal rounded-[14px] border border-white/10 bg-white/[0.055] p-0 text-left text-zinc-100 hover:border-white/20 hover:bg-white/[0.085]",
          selected &&
            "border-orange-300/[0.35] bg-orange-500/[0.14] shadow-[0_0_0_1px_rgba(255,107,53,0.12),0_14px_42px_rgba(255,107,53,0.11)]",
        )}
        style={{ animationDelay: `${index * 42}ms` }}
      >
        <motion.button
          type="button"
          onClick={() => onSelect(incident.id)}
          whileTap={{ scale: 0.992 }}
          aria-pressed={selected}
        >
          <span className="block w-full p-3.5">
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="font-mono text-xs font-semibold text-zinc-100">
                  {incident.shortId}
                </span>
                <span className="mt-1 block truncate text-sm font-medium text-zinc-100">
                  {incident.neighborhood}, {incident.county} {incident.state}
                </span>
              </span>
              <Badge
                className={cn(
                  "shrink-0 rounded-[8px] px-2 py-0.5 text-[10px] font-semibold uppercase shadow-none",
                  statusColorClass(incident.verification),
                )}
              >
                {statusLabel(incident.verification)}
              </Badge>
            </span>

            <span className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {formatAge(incident.ageMinutes)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wind className="h-3 w-3" />
                {incident.windSpeedMs.toFixed(1)} m/s @ {Math.round(incident.windDirDeg)}°
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Gauge className="h-3 w-3" />
                FRP {incident.fireRadiativePower.toFixed(0)} MW
              </span>
              <span className="inline-flex items-center gap-1.5 capitalize">
                <Radar className="h-3 w-3" />
                {incident.firmsConfidence}
              </span>
            </span>
            <span className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5">
                {incident.environmental?.source === "open-meteo"
                  ? "Open-Meteo wind"
                  : "wind fallback"}
              </span>
              {typeof incident.environmental?.humidityPct === "number" && (
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5">
                  RH {Math.round(incident.environmental.humidityPct)}%
                </span>
              )}
              {typeof incident.environmental?.fuelDryness === "number" && (
                <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5">
                  dryness {Math.round(incident.environmental.fuelDryness * 100)}%
                </span>
              )}
            </span>

            <span className="mt-3 flex items-center justify-between gap-3 text-[11px] text-zinc-400">
              <span className="min-w-0 truncate">
                {incident.stations[0] ? (
                  <>
                    nearest{" "}
                    <span className="text-zinc-100">
                      {incident.stations[0].name.split(" ").slice(0, 3).join(" ")}
                    </span>{" "}
                    · {incident.stations[0].etaMinutes} min
                  </>
                ) : (
                  <span className="italic">no stations in range</span>
                )}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            </span>
          </span>
        </motion.button>
      </Button>
    </li>
  );
}

function MapPanel({
  incidents,
  selectedId,
  selected,
  onSelect,
  hazard,
  setHazard,
  view,
  setView,
}: {
  incidents: ConsoleIncident[];
  selectedId: string | null;
  selected: ConsoleIncident | null;
  onSelect: (id: string) => void;
  hazard: HazardKind;
  setHazard: (h: HazardKind) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  // 3D auto-picks the first incident if none is selected, so the toggle is
  // never dead. We also bias the 3D scene to the highest-FRP incident when
  // there's no explicit selection (it's the most interesting visualisation).
  const fallback = useMemo(
    () => [...incidents].sort((a, b) => b.fireRadiativePower - a.fireRadiativePower)[0] ?? null,
    [incidents],
  );
  const sceneIncident = selected ?? fallback;
  const showing3d =
    (view === "3d" || view === "3d-ai") && hazard === "fire" && sceneIncident !== null;
  const useOnnxModel = view === "3d-ai";

  // FIRMS multi-fire integration (Agent A). Every fire incident becomes
  // a hotspot for the 3D scene; the bbox is the smallest box covering all
  // visible incidents with a small pad. The same bbox is reused by Agent
  // C's hooks (useDemHeightmap + useWindGrid) inside FireSimulator3DLive
  // to fetch real terrain + wind for that area — one bbox drives both.
  const fireHotspots = useMemo(
    () =>
      incidents.map((i) => ({
        id: i.id,
        lat: i.lat,
        lon: i.lon,
        frp: i.fireRadiativePower,
        confidence: i.firmsConfidence,
        label: i.neighborhood,
        brightTi4: i.brightTi4,
      })),
    [incidents],
  );
  const fireBbox = useMemo(
    () =>
      bboxFromPoints(
        fireHotspots.map((h) => ({ lat: h.lat, lon: h.lon })),
        0.06,
      ),
    [fireHotspots],
  );
  return (
    <section
      className="sentry-map-stage relative h-full min-h-0 overflow-hidden bg-[#060609]"
      aria-label="Live wildfire map"
    >
      {showing3d && sceneIncident ? (
        useOnnxModel ? (
          // ONNX model overlay (Agent B). Sidecar — does its own scene.
          <FireSimulator3DOnnxOverlay
            windDirDeg={sceneIncident.windDirDeg}
            windSpeedMs={sceneIncident.windSpeedMs}
            predicted1hAcres={
              sceneIncident.predictedSpread.find((p) => p.horizonMin === 60)?.areaAcres
            }
            predicted6hAcres={
              sceneIncident.predictedSpread.find((p) => p.horizonMin === 360)?.areaAcres
            }
            predicted24hAcres={
              sceneIncident.predictedSpread.find((p) => p.horizonMin === 1440)?.areaAcres
            }
            risk={
              sceneIncident.fireRadiativePower > 300
                ? "CRITICAL"
                : sceneIncident.fireRadiativePower > 150
                  ? "HIGH"
                  : "MODERATE"
            }
            useOnnx
          />
        ) : (
          // Default 3D scene. FireSimulator3DLive (Agent C) wraps with the
          // DEM + wind-grid hooks; we forward Agent A's hotspots, fireBbox,
          // and tourMode through it for full multi-fire FIRMS rendering.
          <FireSimulator3DLive
            bbox={fireBbox}
            windDirDeg={sceneIncident.windDirDeg}
            windSpeedMs={sceneIncident.windSpeedMs}
            predicted1hAcres={
              sceneIncident.predictedSpread.find((p) => p.horizonMin === 60)?.areaAcres
            }
            predicted6hAcres={
              sceneIncident.predictedSpread.find((p) => p.horizonMin === 360)?.areaAcres
            }
            predicted24hAcres={
              sceneIncident.predictedSpread.find((p) => p.horizonMin === 1440)?.areaAcres
            }
            risk={
              sceneIncident.fireRadiativePower > 300
                ? "CRITICAL"
                : sceneIncident.fireRadiativePower > 150
                  ? "HIGH"
                  : "MODERATE"
            }
            resources={sceneIncident.stations.slice(0, 6).map((s, idx) => ({
              id: s.id,
              kind: idx === 0 ? "helicopter" : idx === 1 ? "fixed-wing" : idx === 2 ? "dozer" : "engine",
              bearingDeg: idx * 60 + 30,
              distanceKm: s.distanceKm ?? 5 + idx * 1.5,
              etaMinutes: s.etaMinutes,
            }))}
            hotspots={fireHotspots}
            tourMode={fireHotspots.length > 1}
          />
        )
      ) : hazard === "earthquake" ? (
        <EarthquakeMap />
      ) : hazard === "flood" ? (
        <FloodMap />
      ) : (
        <LeafletMap
        incidents={incidents.map((i) => ({
          id: i.id,
          shortId: i.shortId,
          lat: i.lat,
          lon: i.lon,
          status: i.verification,
          windDirDeg: i.windDirDeg,
          windSpeedMs: i.windSpeedMs,
          fuelFactor:
            typeof i.environmental?.fuelDryness === "number"
              ? Math.max(0.35, Math.min(1, i.environmental.fuelDryness))
              : undefined,
          predictedSpread: i.predictedSpread.map((p) => ({
            horizonMin: p.horizonMin,
            areaAcres: p.areaAcres,
            bearingDeg: p.bearingDeg,
          })),
          stations: i.stations
            .map((s) => ({
              id: s.id,
              name: s.name,
              etaMinutes: s.etaMinutes,
              lat: s.lat ?? 0,
              lon: s.lon ?? 0,
            }))
            .filter((s) => s.lat !== 0),
          selected: i.id === selectedId,
        }))}
          onIncidentClick={onSelect}
          height="100%"
          className="absolute inset-0 h-full w-full"
        />
      )}

      {/* Hazard switcher + 2D/3D toggle — shadcn Tabs, no gradients. */}
      <div className="absolute left-4 top-4 z-[403] flex flex-col gap-2">
        <Tabs value={hazard} onValueChange={(v) => setHazard(v as HazardKind)}>
          <TabsList className="h-8 bg-card/85 p-0.5 shadow-md backdrop-blur-md">
            <TabsTrigger value="fire" className="h-7 px-3 text-[10px] font-medium uppercase tracking-wide">
              Fire
            </TabsTrigger>
            <TabsTrigger value="earthquake" className="h-7 px-3 text-[10px] font-medium uppercase tracking-wide">
              Earthquake
            </TabsTrigger>
            <TabsTrigger value="flood" className="h-7 px-3 text-[10px] font-medium uppercase tracking-wide">
              Flood
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {hazard === "fire" && (
          <Tabs value={view} onValueChange={(v) => setView(v as ViewMode)}>
            <TabsList className="h-8 w-fit bg-card/85 p-0.5 shadow-md backdrop-blur-md">
              <TabsTrigger value="2d" className="h-7 px-3 text-[10px] font-medium uppercase tracking-wide">
                2D
              </TabsTrigger>
              <TabsTrigger value="3d" className="h-7 px-3 text-[10px] font-medium uppercase tracking-wide">
                3D
              </TabsTrigger>
              <TabsTrigger value="3d-ai" className="h-7 px-3 text-[10px] font-medium uppercase tracking-wide">
                3D + AI
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      {/* Decorative status pills removed — they competed with the basemap +
          layers card for the same top-right corner. The legend at bottom-left
          still indicates the live/fallback state when needed. */}

      {/* HOTSPOTS legend is fire-specific — hide it when in earthquake/flood
          mode so it doesn't overlap with the EarthquakeMap / FloodMap detail
          cards (which open at bottom-left). */}
      {hazard === "fire" && <MapLegend />}

      {hazard === "fire" && selected && <SelectedMapCard incident={selected} />}
    </section>
  );
}

function HazardComingSoon({
  title,
  subtitle,
  source,
  paperUrl,
}: {
  title: string;
  subtitle: string;
  source: string;
  paperUrl: string;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[#060609] p-6">
      <div className="sentry-glass-strong max-w-md rounded-[16px] p-6 text-center">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--sentry-orange-light)]">
          model architecture ready · ingestion pending
        </div>
        <h2 className="mb-1 text-lg font-semibold text-zinc-100">{title}</h2>
        <p className="mb-4 text-sm text-zinc-400">{subtitle}</p>
        <div className="space-y-2 text-left">
          <div className="rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400">
            <span className="text-zinc-500">Live source · </span>
            <span className="text-zinc-200">{source}</span>
          </div>
          <a
            href={paperUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400 transition hover:bg-white/[0.06]"
          >
            <span className="text-zinc-500">Reference · </span>
            <span className="text-[var(--sentry-orange-light)] underline-offset-2 hover:underline">
              {paperUrl}
            </span>
          </a>
        </div>
        <p className="mt-4 text-[11px] text-zinc-500">
          Architecture in <code className="text-zinc-300">ml/models/</code>; tests passing.
          Live ingestion + inference wiring lands when the API service for this hazard ships.
        </p>
      </div>
    </div>
  );
}

function GlassPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="sentry-glass flex items-center gap-2 rounded-[999px] px-3 py-2 text-xs">
      <span className="text-[var(--sentry-orange-light)] [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <span className="text-zinc-300">{label}</span>
      <span className="text-zinc-500">{value}</span>
    </div>
  );
}

function MapLegend() {
  return (
    <div className="sentry-glass pointer-events-none absolute bottom-4 left-4 z-[403] rounded-[14px] p-3">
      <div className="text-[10px] font-medium uppercase text-zinc-500">Hotspots</div>
      <div className="mt-2 grid gap-1.5 text-xs">
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
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hotspotColor(k) }} />
            <span className="text-zinc-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SelectedMapCard({ incident }: { incident: ConsoleIncident }) {
  return (
    <motion.div
      key={incident.id}
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.42, ease: [0.34, 1.56, 0.64, 1] }}
      className="sentry-glass-strong absolute bottom-4 right-4 z-[403] w-[min(390px,calc(100%-2rem))] rounded-[16px] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs font-semibold text-zinc-200">{incident.shortId}</div>
          <div className="mt-1 text-base font-semibold leading-tight text-zinc-50">
            {incident.neighborhood}
          </div>
          <div className="mt-1 text-xs text-zinc-400">
            {incident.county} {incident.state} · {formatAge(incident.ageMinutes)}
          </div>
        </div>
        <Badge
          className={cn(
            "rounded-[8px] text-[10px] uppercase shadow-none",
            statusColorClass(incident.verification),
          )}
        >
          {statusLabel(incident.verification)}
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniMetric label="FRP" value={`${incident.fireRadiativePower.toFixed(0)} MW`} />
        <MiniMetric label="Wind" value={`${incident.windSpeedMs.toFixed(1)} m/s`} />
        <MiniMetric
          label="Dryness"
          value={
            typeof incident.environmental?.fuelDryness === "number"
              ? `${Math.round(incident.environmental.fuelDryness * 100)}%`
              : "n/a"
          }
        />
      </div>
    </motion.div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.06] px-2.5 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-zinc-100">{value}</div>
    </div>
  );
}

function EnvironmentalGrid({ environmental }: { environmental?: EnvironmentalInputs }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      <MiniMetric
        label="Weather"
        value={environmental?.source === "open-meteo" ? "Open-Meteo" : "fallback"}
      />
      <MiniMetric
        label="RH"
        value={
          typeof environmental?.humidityPct === "number"
            ? `${Math.round(environmental.humidityPct)}%`
            : "n/a"
        }
      />
      <MiniMetric
        label="10d precip"
        value={
          typeof environmental?.precip10dMm === "number"
            ? `${environmental.precip10dMm.toFixed(1)} mm`
            : "n/a"
        }
      />
      <MiniMetric
        label="Fuel dryness"
        value={
          typeof environmental?.fuelDryness === "number"
            ? `${Math.round(environmental.fuelDryness * 100)}%`
            : "n/a"
        }
      />
    </div>
  );
}

function DetailSheet({ incident, onClose }: { incident: ConsoleIncident; onClose: () => void }) {
  const dispatchable =
    incident.verification === "EMERGING" || incident.verification === "UNREPORTED";
  const [dispatching, setDispatching] = useState(false);

  const handleDispatch = useCallback(async () => {
    if (!dispatchable || dispatching) return;
    setDispatching(true);
    const result = await postDispatch(incident.id);
    setDispatching(false);
    if (isOk(result)) {
      const eta = result.data.eta_minutes ?? incident.stations[0]?.etaMinutes;
      const station = result.data.station_id ?? incident.stations[0]?.name ?? "nearest";
      toast.success(
        `Dispatch sent — ${typeof eta === "number" ? `ETA ${eta} min` : "in flight"}`,
        { description: `${incident.shortId} → ${station}` },
      );
    } else {
      toast.error(`Dispatch failed: ${result.error}`, {
        description: `Backend unreachable; check that the FastAPI service at NEXT_PUBLIC_API_BASE_URL is running.`,
      });
    }
  }, [dispatchable, dispatching, incident]);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        overlayClassName="bg-black/10 backdrop-blur-[1px]"
        className="sentry-glass-strong inset-y-0 right-0 flex h-screen w-[min(560px,100vw)] max-w-none flex-col rounded-none border-y-0 border-r-0 border-white/[0.15] p-0 shadow-2xl sm:max-w-none"
        aria-label={`Incident ${incident.shortId} detail`}
      >
        <SheetHeader className="space-y-2 border-b border-white/10 px-5 py-4 pr-12 text-left">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="font-mono text-sm font-semibold text-zinc-100">
                {incident.shortId}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs text-zinc-400">
                {incident.neighborhood}, {incident.county} {incident.state} ·{" "}
                {formatAge(incident.ageMinutes)}
              </SheetDescription>
            </div>
            <Badge
              className={cn(
                "rounded-[8px] px-2 text-[10px] uppercase shadow-none",
                statusColorClass(incident.verification),
              )}
            >
              {statusLabel(incident.verification)}
            </Badge>
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-5">
            <Section
              icon={<ShieldAlert className="h-3.5 w-3.5" />}
              title="Intelligence"
              subtitle="Live cross-check"
            >
              <IntelPanel incidentId={incident.id} />
            </Section>

            <Section
              icon={<MapPin className="h-3.5 w-3.5" />}
              title="Hotspot"
              subtitle="Satellite thermal anomaly"
            >
              <div className="grid grid-cols-2 gap-3 text-xs">
                <Field label="Lat" value={incident.lat.toFixed(4)} />
                <Field label="Lon" value={incident.lon.toFixed(4)} />
                <Field label="FIRMS confidence" value={incident.firmsConfidence} capitalize />
                <Field label="Bright TI4" value={`${incident.brightTi4.toFixed(1)} K`} />
                <Field label="FRP" value={`${incident.fireRadiativePower.toFixed(0)} MW`} />
                <Field label="Age" value={`${incident.ageMinutes} min`} />
              </div>
            </Section>

            <Section
              icon={<Wind className="h-3.5 w-3.5" />}
              title="Wind and spread"
              subtitle="Environmental inputs and ML contour horizons"
            >
              <div className="flex items-center gap-4">
                <WindRose dirDeg={incident.windDirDeg} speedMs={incident.windSpeedMs} />
                <div className="text-xs">
                  <div className="font-medium text-zinc-100">
                    {incident.windSpeedMs.toFixed(1)} m/s @ {Math.round(incident.windDirDeg)}° from
                  </div>
                  <div className="mt-1 text-zinc-400">
                    {incident.environmental?.source === "open-meteo"
                      ? "Open-Meteo current weather"
                      : "Fixture fallback; live weather unavailable"}{" "}
                    · spread model input
                  </div>
                </div>
              </div>
              <EnvironmentalGrid environmental={incident.environmental} />
              {incident.predictedSpread.length > 0 ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {incident.predictedSpread.map((p) => (
                    <div
                      key={p.horizonMin}
                      className="rounded-[10px] border border-white/10 bg-white/[0.06] px-2.5 py-2 text-xs"
                    >
                      <div className="text-[10px] uppercase text-zinc-500">
                        +{p.horizonMin === 60 ? "1h" : p.horizonMin === 360 ? "6h" : "24h"}
                      </div>
                      <div className="mt-1 font-semibold text-zinc-100">
                        {p.areaAcres.toLocaleString()} acres
                      </div>
                      <div className="text-[10px] text-zinc-500">bearing {p.bearingDeg}°</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-[10px] border border-dashed border-white/[0.15] px-3 py-2 text-xs text-zinc-400">
                  Spread suppressed because this verification status does not warrant prediction.
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
              subtitle="News, social, scanner and registry"
            >
              {incident.verificationSources.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-white/[0.15] px-3 py-3 text-xs text-zinc-400">
                  No corroborating signals in the last 60 minutes.
                </div>
              ) : (
                <ul className="space-y-2">
                  {incident.verificationSources.map((s, idx) => (
                    <li
                      key={idx}
                      className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-3 text-[10px] uppercase text-zinc-500">
                        <span className="inline-flex items-center gap-1.5">
                          {sourceIcon(s.kind)} {s.kind} · {s.source}
                        </span>
                        <span>{s.ageMinutes} min ago</span>
                      </div>
                      <div className="mt-1 font-medium text-zinc-100">{s.title}</div>
                      <div className="mt-0.5 text-zinc-400">{s.snippet}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section
              icon={<Truck className="h-3.5 w-3.5" />}
              title="Nearest stations"
              subtitle="ETA ranked"
            >
              {incident.stations.length === 0 ? (
                <div className="rounded-[10px] border border-dashed border-white/[0.15] px-3 py-3 text-xs text-zinc-400">
                  No stations within range.
                </div>
              ) : (
                <ul className="space-y-2">
                  {incident.stations.map((s, idx) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-3 rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2 text-xs"
                    >
                      <div>
                        <div className="font-medium text-zinc-100">
                          {idx === 0 && <span className="mr-1.5 text-emerald-300">●</span>}
                          {s.name}
                        </div>
                        <div className="text-[11px] text-zinc-500">{s.agency}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-zinc-100">{s.etaMinutes} min</div>
                        <div className="text-[11px] text-zinc-500">
                          {s.distanceKm.toFixed(1)} km
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </ScrollArea>

        <SheetFooter className="border-t border-white/10 bg-black/[0.14] px-5 py-4 sm:flex-col sm:space-x-0">
          <Button
            disabled={!dispatchable || dispatching}
            onClick={handleDispatch}
            className={cn(
              "h-11 w-full rounded-md text-sm font-semibold",
              dispatchable
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed border border-border bg-muted text-muted-foreground",
            )}
          >
            <Send className="h-4 w-4" />
            {dispatchable
              ? dispatching
                ? "Dispatching…"
                : `Dispatch ${
                    incident.stations[0]?.name.split(" ").slice(0, 3).join(" ") ?? "nearest"
                  }`
              : "Dispatch suppressed for this verification status"}
          </Button>
          <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-zinc-500">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" />
              human-in-the-loop · audit logged
            </span>
            <span>Esc closes detail</span>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="sentry-glass rounded-[14px] p-3.5">
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-orange-500/[0.12] text-[var(--sentry-orange-light)]">
          {icon}
        </span>
        <div>
          <div className="font-semibold text-zinc-100">{title}</div>
          <div className="text-[11px] text-zinc-500">{subtitle}</div>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  capitalize,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="rounded-[10px] border border-white/10 bg-white/[0.06] px-3 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 font-semibold text-zinc-100", capitalize && "capitalize")}>
        {value}
      </div>
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
      <circle cx={36} cy={36} r={32} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
      <circle
        cx={36}
        cy={36}
        r={20}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth="0.6"
        strokeDasharray="2 2"
      />
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
      <line
        x1={36}
        y1={36}
        x2={x}
        y2={y}
        stroke="var(--sentry-orange-light)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <line
        x1={36}
        y1={36}
        x2={tx}
        y2={ty}
        stroke="rgba(255,255,255,0.24)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx={36} cy={36} r="2.7" fill="var(--sentry-orange-light)" />
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
