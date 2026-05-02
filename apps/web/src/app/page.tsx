import Link from "next/link";
import { Flame, Radar, ShieldAlert } from "lucide-react";

export default function HomePage() {
  return (
    <main className="container mx-auto flex min-h-screen flex-col gap-12 px-4 py-12">
      <header className="flex items-center gap-3">
        <Flame className="h-8 w-8 text-primary animate-flicker" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">IgnisLink</h1>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          v0 · stage-0 scaffold
        </span>
      </header>

      <section className="space-y-3">
        <h2 className="text-balance text-4xl font-semibold leading-tight">
          Real-time wildfire detection, prediction, and dispatch.
        </h2>
        <p className="max-w-2xl text-pretty text-base text-muted-foreground">
          IgnisLink ingests NASA FIRMS thermal anomalies, verifies them against news and social
          signals, predicts spread with a custom ML model conditioned on live wind and fuel, and
          routes verified incidents to the nearest fire station.
        </p>
        <p className="text-sm text-muted-foreground">
          This is the public situational awareness page. The live map lands in Stage 1 — see{" "}
          <Link href="/console" className="underline underline-offset-4 hover:text-foreground">
            /console
          </Link>{" "}
          for the dispatcher view (auth-gated when wired up).
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <FeatureCard
          icon={<Radar className="h-5 w-5" aria-hidden />}
          title="Detection"
          body="FIRMS VIIRS URT every 60 s, deduped and reverse-geocoded."
        />
        <FeatureCard
          icon={<Flame className="h-5 w-5" aria-hidden />}
          title="Prediction"
          body="U-Net + ConvLSTM model emits 1 h / 6 h / 24 h burn-probability rasters."
        />
        <FeatureCard
          icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
          title="Dispatch"
          body="Nearest-3-stations ranked by ETA, with suggested upwind staging."
        />
      </section>

      <footer className="mt-auto text-xs text-muted-foreground">
        IgnisLink is a situational tool. For evacuation orders, follow your local Authority Having
        Jurisdiction.
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <h3 className="text-sm font-medium uppercase tracking-wide text-foreground">{title}</h3>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{body}</p>
    </article>
  );
}
