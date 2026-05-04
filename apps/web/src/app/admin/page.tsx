"use client";

import { useState } from "react";
import {
  Flame,
  Settings,
  Map as MapIcon,
  Camera,
  Brain,
  ScrollText,
  VolumeX,
  Plus,
  Edit3,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Section = "boxes" | "routing" | "cameras" | "models" | "audit" | "mute";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "boxes", label: "Bounding boxes", icon: <MapIcon className="h-4 w-4" /> },
  { id: "routing", label: "Routing rules", icon: <Settings className="h-4 w-4" /> },
  { id: "cameras", label: "Camera registry", icon: <Camera className="h-4 w-4" /> },
  { id: "models", label: "Model versions", icon: <Brain className="h-4 w-4" /> },
  { id: "audit", label: "Audit log", icon: <ScrollText className="h-4 w-4" /> },
  { id: "mute", label: "Mute regions", icon: <VolumeX className="h-4 w-4" /> },
];

export default function AdminPage() {
  const [section, setSection] = useState<Section>("boxes");

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card/40 px-5 py-3">
        <Flame className="h-5 w-5 text-primary animate-flicker" aria-hidden />
        <h1 className="text-base font-semibold tracking-tight">SENTRY Admin</h1>
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
          v0 · auth-gated in stage 5
        </span>
        <span className="ml-auto rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
          ● admin · operator-1
        </span>
      </header>

      <div className="grid flex-1 grid-cols-[220px_1fr]">
        <nav aria-label="Admin sections" className="border-r border-border bg-card/20 p-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition",
                section === s.id
                  ? "bg-card text-foreground"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        <section className="overflow-auto p-6">
          {section === "boxes" && <BoundingBoxes />}
          {section === "routing" && <RoutingRules />}
          {section === "cameras" && <CameraRegistry />}
          {section === "models" && <ModelVersions />}
          {section === "audit" && <AuditLog />}
          {section === "mute" && <MuteRegions />}
        </section>
      </div>
    </main>
  );
}

function BoundingBoxes() {
  const boxes = [
    { id: "bb-conus", name: "CONUS coverage", bbox: "-125, 24, -66, 50", interval: 60, status: "active" },
    { id: "bb-norcal", name: "Northern California (priority)", bbox: "-124, 36, -119, 42", interval: 30, status: "active" },
    { id: "bb-pnw", name: "Pacific Northwest", bbox: "-124, 42, -116, 49", interval: 60, status: "active" },
    { id: "bb-sw", name: "Southwest WUI", bbox: "-115, 31, -103, 37", interval: 90, status: "paused" },
  ];
  return (
    <Card title="Bounding boxes" subtitle="Configure the FIRMS poller scope and per-region cron interval.">
      <div className="overflow-hidden rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-card/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Region</th>
              <th className="px-3 py-2 text-left">BBOX (lon, lat)</th>
              <th className="px-3 py-2 text-left">Interval</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {boxes.map((b) => (
              <tr key={b.id} className="hover:bg-card/30">
                <td className="px-3 py-2 font-medium">{b.name}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{b.bbox}</td>
                <td className="px-3 py-2">{b.interval}s</td>
                <td className="px-3 py-2">
                  <StatusPill kind={b.status === "active" ? "ok" : "muted"}>
                    {b.status}
                  </StatusPill>
                </td>
                <td className="px-3 py-2 text-right">
                  <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <Edit3 className="h-3 w-3" /> Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="mt-3 inline-flex items-center gap-1.5 rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> Add bounding box
      </button>
    </Card>
  );
}

function RoutingRules() {
  const rules = [
    { id: "r1", region: "El Dorado County", primary: "El Dorado Cnty FD", fallback: "Cal Fire AEU", afterHours: "Cal Fire AEU" },
    { id: "r2", region: "Lane County, OR", primary: "Eugene-Springfield FR", fallback: "Lane Fire Authority", afterHours: "Lane Fire Authority" },
    { id: "r3", region: "Washoe County, NV", primary: "Reno FD", fallback: "Truckee Meadows FR", afterHours: "Sparks FD" },
    { id: "r4", region: "Monterey County, CA", primary: "Monterey Cnty FD", fallback: "Cal Fire BEU", afterHours: "Cal Fire BEU" },
  ];
  return (
    <Card title="Routing rules" subtitle="Region → primary station + fallback + after-hours escalation.">
      <ul className="space-y-2">
        {rules.map((r) => (
          <li key={r.id} className="rounded border border-border bg-card/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.region}</span>
              <button className="text-xs text-muted-foreground hover:text-foreground">Edit</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Primary</div>
                <div className="mt-0.5">{r.primary}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fallback</div>
                <div className="mt-0.5 text-muted-foreground">{r.fallback}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">After hours</div>
                <div className="mt-0.5 text-muted-foreground">{r.afterHours}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CameraRegistry() {
  const cameras = [
    { id: "cam-1", name: "Pano AI · Sacramento Foothills 12", kind: "pano", state: "online", lastFrame: "8s ago" },
    { id: "cam-2", name: "ALERTWildfire · Tahoe Ridge North", kind: "rtsp", state: "online", lastFrame: "3s ago" },
    { id: "cam-3", name: "ONVIF · El Dorado Tower 4", kind: "onvif", state: "online", lastFrame: "12s ago" },
    { id: "cam-4", name: "Pano AI · Lane County Lookout", kind: "pano", state: "degraded", lastFrame: "94s ago" },
    { id: "cam-5", name: "ONVIF · Otay Mesa Industrial", kind: "onvif", state: "offline", lastFrame: "—" },
  ];
  return (
    <Card title="Camera registry" subtitle="ONVIF, Pano AI, RTSP feeds with view-cone geofencing. YOLOv8 inference on hotspot intersect.">
      <ul className="space-y-1.5">
        {cameras.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded border border-border bg-card/40 px-3 py-2 text-xs">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-[11px] text-muted-foreground">
                kind · <span className="font-mono">{c.kind}</span> · last frame {c.lastFrame}
              </div>
            </div>
            <StatusPill
              kind={c.state === "online" ? "ok" : c.state === "degraded" ? "warn" : "err"}
            >
              {c.state}
            </StatusPill>
          </li>
        ))}
      </ul>
      <button className="mt-3 inline-flex items-center gap-1.5 rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> Register camera
      </button>
    </Card>
  );
}

function ModelVersions() {
  const versions = [
    {
      id: "v0.3.1",
      tag: "Production",
      promoted: "2026-04-28",
      iou6h: 0.58,
      iou24h: 0.42,
      ece: 0.041,
    },
    {
      id: "v0.3.0",
      tag: "Archived",
      promoted: "2026-04-12",
      iou6h: 0.55,
      iou24h: 0.40,
      ece: 0.046,
    },
    {
      id: "v0.4.0-rc1",
      tag: "Staging",
      promoted: "2026-05-01",
      iou6h: 0.61,
      iou24h: 0.43,
      ece: 0.039,
    },
  ];
  return (
    <Card title="fire-spread model" subtitle="MLflow-tracked. Production rollback takes effect within 5 min.">
      <div className="overflow-hidden rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-card/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Version</th>
              <th className="px-3 py-2 text-left">Stage</th>
              <th className="px-3 py-2 text-left">Promoted</th>
              <th className="px-3 py-2 text-right">6 h IoU</th>
              <th className="px-3 py-2 text-right">24 h IoU</th>
              <th className="px-3 py-2 text-right">ECE</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {versions.map((v) => (
              <tr key={v.id} className="hover:bg-card/30">
                <td className="px-3 py-2 font-mono">{v.id}</td>
                <td className="px-3 py-2">
                  <StatusPill
                    kind={v.tag === "Production" ? "ok" : v.tag === "Staging" ? "warn" : "muted"}
                  >
                    {v.tag}
                  </StatusPill>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{v.promoted}</td>
                <td className="px-3 py-2 text-right">{v.iou6h.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{v.iou24h.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{v.ece.toFixed(3)}</td>
                <td className="px-3 py-2 text-right">
                  {v.tag === "Archived" ? (
                    <button className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                      <RotateCcw className="h-3 w-3" /> Revert
                    </button>
                  ) : v.tag === "Staging" ? (
                    <button className="text-emerald-400 hover:text-emerald-300">Promote</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AuditLog() {
  const entries = [
    {
      ts: "2026-05-02T05:08:14Z",
      actor: "operator-1",
      action: "DISPATCH",
      target: "IG-2K91 → Pollock Pines Station 28",
      payload: "model v0.3.1 · 6h IoU 0.58",
    },
    {
      ts: "2026-05-02T04:53:01Z",
      actor: "operator-1",
      action: "MUTE",
      target: "IG-9NB7 (Sequoia NF prescribed burn)",
      payload: "registry-match · auto-suppress",
    },
    {
      ts: "2026-05-02T04:42:38Z",
      actor: "operator-2",
      action: "DISPATCH",
      target: "IG-3MX2 → Eugene-Springfield Station 9",
      payload: "model v0.3.1 · webhook 200 OK",
    },
    {
      ts: "2026-05-02T04:31:22Z",
      actor: "system",
      action: "MODEL_PROMOTE",
      target: "fire-spread v0.4.0-rc1 → Staging",
      payload: "no per-ecoregion regression",
    },
    {
      ts: "2026-05-02T03:48:11Z",
      actor: "operator-1",
      action: "REASSIGN",
      target: "IG-7HQ4 → Coalinga Station 33 (fallback)",
      payload: "primary unavailable",
    },
  ];
  return (
    <Card title="Audit log" subtitle="Append-only. Every dispatch + admin action is recorded with the model version that produced its predictions.">
      <ul className="divide-y divide-border rounded border border-border">
        {entries.map((e, i) => (
          <li key={i} className="flex items-start gap-3 px-3 py-2 text-xs hover:bg-card/30">
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{e.ts.slice(11, 19)}Z</span>
            <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{e.actor}</span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                e.action === "DISPATCH"
                  ? "bg-orange-950/40 text-orange-300"
                  : e.action === "MODEL_PROMOTE"
                  ? "bg-blue-950/40 text-blue-300"
                  : e.action === "MUTE"
                  ? "bg-zinc-800 text-zinc-300"
                  : "bg-emerald-950/40 text-emerald-300",
              )}
            >
              {e.action}
            </span>
            <span className="flex-1 truncate">{e.target}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{e.payload}</span>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MuteRegions() {
  const mutes = [
    { id: "m1", region: "Sequoia NF Unit 12", reason: "USFS prescribed burn", expires: "2026-05-03T18:00Z" },
    { id: "m2", region: "Otay Mesa S-1", reason: "Refinery flare zone", expires: "permanent" },
  ];
  return (
    <Card title="Mute regions" subtitle="Temporary suppression for prescribed burns or known events.">
      <ul className="space-y-2">
        {mutes.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded border border-border bg-card/40 px-3 py-2 text-xs">
            <div>
              <div className="font-medium">{m.region}</div>
              <div className="text-[11px] text-muted-foreground">
                {m.reason} · expires {m.expires}
              </div>
            </div>
            <button className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              Unmute
            </button>
          </li>
        ))}
      </ul>
      <button className="mt-3 inline-flex items-center gap-1.5 rounded border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground">
        <Plus className="h-3 w-3" /> Add mute region
      </button>
    </Card>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <article className="space-y-3">
      <header>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </header>
      {children}
    </article>
  );
}

function StatusPill({
  kind,
  children,
}: {
  kind: "ok" | "warn" | "err" | "muted";
  children: React.ReactNode;
}) {
  const cls =
    kind === "ok"
      ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
      : kind === "warn"
      ? "border-amber-700 bg-amber-950/40 text-amber-300"
      : kind === "err"
      ? "border-red-700 bg-red-950/40 text-red-300"
      : "border-zinc-700 bg-zinc-900 text-zinc-400";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        cls,
      )}
    >
      {children}
    </span>
  );
}
