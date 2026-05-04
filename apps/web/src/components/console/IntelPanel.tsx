"use client";

import { useEffect, useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Satellite,
  Radio,
  Newspaper,
  Building2,
  MessageSquare,
  Users,
  Flame,
  CloudRain,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface IntelResponse {
  incidentId: string;
  fetchedAt: string;
  sources: {
    kind: "news" | "social" | "scanner" | "registry";
    title: string;
    source: string;
    snippet: string;
    ageMinutes: number;
  }[];
  firms: {
    ok: boolean;
    matched: boolean;
    closestKm: number | null;
    hits: { latitude: number; longitude: number; brightness: number; frp: number }[];
    source: string;
    error?: string;
  };
  calfire: {
    ok: boolean;
    match: {
      Name: string;
      AdminUnit?: string;
      AcresBurned: number | null;
      PercentContained: number | null;
      Started: string;
      IsActive: boolean;
    } | null;
    matchDistanceKm: number | null;
    error?: string;
  };
  crew: { onScene: boolean; source: string | null; rationale: string };
  threat: {
    fireIntensity: number;
    populationThreat: number;
    containment: number;
    controlledLikelihood: number;
    lethalRisk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
    lethalRiskScore: number;
    rationale: string[];
  };
  population: {
    pop5km: number;
    pop25km: number;
    nearestCity: { name: string; state: string; distanceKm: number; pop: number } | null;
    score: number;
  };
  fuelFactor: number;
}

export function IntelPanel({ incidentId }: { incidentId: string }) {
  const [data, setData] = useState<IntelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/intel/${incidentId}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<IntelResponse>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  if (loading)
    return (
      <div className="flex items-center gap-2 rounded border border-border bg-card/40 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Fetching live intel · cross-checking FIRMS, Cal Fire, scanner…
      </div>
    );
  if (error || !data)
    return (
      <div className="rounded border border-red-900/30 bg-red-950/20 p-3 text-xs text-red-300">
        Intel unavailable: {error ?? "no data"}
      </div>
    );

  return (
    <div className="space-y-4">
      {/* Lethal-risk headline */}
      <RiskHeadline
        risk={data.threat.lethalRisk}
        score={data.threat.lethalRiskScore}
        rationale={data.threat.rationale}
      />

      {/* Cross-checks grid */}
      <div className="grid grid-cols-2 gap-2">
        <CrossCheckCard
          icon={<Satellite className="h-3.5 w-3.5" />}
          label="NASA FIRMS"
          ok={data.firms.matched}
          okLabel={
            data.firms.matched
              ? `Confirmed · ${data.firms.closestKm?.toFixed(1)} km`
              : data.firms.ok
                ? "No corroborating hit (24 h)"
                : "Unavailable"
          }
          detail={
            data.firms.hits.length > 0
              ? `${data.firms.hits.length} satellite hits in 25 km bbox`
              : data.firms.error ?? null
          }
        />
        <CrossCheckCard
          icon={<Flame className="h-3.5 w-3.5" />}
          label="Cal Fire"
          ok={!!data.calfire.match}
          okLabel={
            data.calfire.match
              ? `${data.calfire.match.Name} · ${data.calfire.matchDistanceKm?.toFixed(1)} km`
              : data.calfire.ok
                ? "No active CA incident match"
                : "Feed error"
          }
          detail={
            data.calfire.match
              ? `${data.calfire.match.AcresBurned ?? 0} acres · ${data.calfire.match.PercentContained ?? 0}% contained · ${data.calfire.match.AdminUnit ?? ""}`
              : data.calfire.error ?? null
          }
        />
        <CrossCheckCard
          icon={<Radio className="h-3.5 w-3.5" />}
          label="Crews on scene"
          ok={data.crew.onScene}
          okLabel={data.crew.onScene ? "Yes" : "Not confirmed"}
          detail={data.crew.rationale}
        />
        <CrossCheckCard
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          label="Controlled?"
          ok={data.threat.controlledLikelihood >= 80}
          okLabel={`${data.threat.controlledLikelihood}% likely`}
          detail={
            data.threat.controlledLikelihood >= 80
              ? "Registered prescribed burn or industrial flare."
              : "No registry match."
          }
        />
      </div>

      {/* Per-dimension threat scores */}
      <div className="grid grid-cols-2 gap-2">
        <ScoreBar label="Fire intensity" value={data.threat.fireIntensity} tone="orange" icon={<Flame className="h-3 w-3" />} />
        <ScoreBar label="Population threat" value={data.threat.populationThreat} tone="red" icon={<Users className="h-3 w-3" />} />
        <ScoreBar label="Containment" value={data.threat.containment} tone="emerald" icon={<ShieldCheck className="h-3 w-3" />} />
        <ScoreBar label="Controlled?" value={data.threat.controlledLikelihood} tone="blue" icon={<CheckCircle2 className="h-3 w-3" />} />
      </div>

      {/* Population exposure detail */}
      <div className="rounded border border-border bg-card/60 p-3 text-xs">
        <div className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Users className="h-3 w-3" /> Population exposure
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] text-muted-foreground">Within 5 km</div>
            <div className="font-semibold">{data.population.pop5km.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Within 25 km</div>
            <div className="font-semibold">{data.population.pop25km.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Nearest urban</div>
            <div className="font-semibold">
              {data.population.nearestCity
                ? `${data.population.nearestCity.name}, ${data.population.nearestCity.state}`
                : "—"}
            </div>
            {data.population.nearestCity && (
              <div className="text-[10px] text-muted-foreground">
                {data.population.nearestCity.distanceKm.toFixed(0)} km · pop{" "}
                {data.population.nearestCity.pop.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Verification sources roll-up */}
      <div>
        <div className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Newspaper className="h-3 w-3" /> Verification sources
        </div>
        {data.sources.length === 0 ? (
          <div className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            No corroborating signals in the last 60 min.
          </div>
        ) : (
          <ul className="space-y-1.5">
            {data.sources.map((s, idx) => (
              <li key={idx} className="rounded border border-border bg-card/60 px-3 py-2 text-xs">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    {sourceIcon(s.kind)} {s.kind} · {s.source}
                  </span>
                  <span>{s.ageMinutes} min ago</span>
                </div>
                <div className="mt-1 font-medium">{s.title}</div>
                <div className="mt-0.5 text-muted-foreground">{s.snippet}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground">
        Fetched {new Date(data.fetchedAt).toLocaleTimeString()} · fuel factor{" "}
        {data.fuelFactor.toFixed(2)} · sources: news/social/scanner + NASA FIRMS{" "}
        ({data.firms.source}) + Cal Fire incidents feed.
      </div>
    </div>
  );
}

function RiskHeadline({
  risk,
  score,
  rationale,
}: {
  risk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  score: number;
  rationale: string[];
}) {
  const palette = {
    LOW: "border-emerald-700 bg-emerald-950/30 text-emerald-200",
    MODERATE: "border-amber-700 bg-amber-950/30 text-amber-200",
    HIGH: "border-orange-700 bg-orange-950/30 text-orange-200",
    CRITICAL: "border-red-700 bg-red-950/30 text-red-200",
  }[risk];
  const Icon = risk === "LOW" ? ShieldCheck : ShieldAlert;
  return (
    <div className={cn("rounded-lg border p-3", palette)}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4" />
        <div className="flex-1">
          <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide opacity-80">
            <span>Lethal wildfire risk</span>
            <span className="font-mono">{score}/100</span>
          </div>
          <div className="text-base font-semibold tracking-tight">{risk}</div>
          <ul className="mt-2 space-y-0.5 text-xs">
            {rationale.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CrossCheckCard({
  icon,
  label,
  ok,
  okLabel,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
  okLabel: string;
  detail: string | null;
}) {
  return (
    <div className="rounded border border-border bg-card/60 px-3 py-2 text-xs">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {icon} {label}
        </span>
        {ok ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
        ) : (
          <XCircle className="h-3 w-3 text-zinc-500" />
        )}
      </div>
      <div className={cn("mt-0.5 font-medium", ok ? "text-foreground" : "text-muted-foreground")}>
        {okLabel}
      </div>
      {detail && <div className="mt-0.5 text-[10px] text-muted-foreground">{detail}</div>}
    </div>
  );
}

function ScoreBar({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: "orange" | "red" | "emerald" | "blue";
  icon: React.ReactNode;
}) {
  const fillCls =
    tone === "orange"
      ? "bg-orange-500"
      : tone === "red"
        ? "bg-red-500"
        : tone === "emerald"
          ? "bg-emerald-500"
          : "bg-blue-500";
  return (
    <div className="rounded border border-border bg-card/60 px-3 py-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {icon} {label}
        </span>
        <span className="font-mono">{value}/100</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded bg-zinc-800">
        <div
          className={cn("h-full transition-all", fillCls)}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
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
