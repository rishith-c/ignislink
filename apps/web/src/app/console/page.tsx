import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Console",
  robots: { index: false, follow: false },
};

/**
 * Dispatcher Console — placeholder.
 *
 * Stage 1 wires the live map (deck.gl + Mapbox), incident queue (shadcn Table),
 * and detail sheet (shadcn Sheet). Real-time over Socket.IO. Components are
 * scaffolded via Magic MCP (`@21st-dev/magic`) per the protocol.
 *
 * See PRD §4.1 for the layout contract.
 */
export default function ConsolePage() {
  return (
    <main className="container mx-auto flex min-h-screen flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dispatcher Console</h1>
        <p className="text-sm text-muted-foreground">
          70/30 map + queue layout lands in Stage 1. This page is a placeholder so routes resolve
          while infra and ingestion come up.
        </p>
      </header>

      <section
        aria-label="Live map placeholder"
        className="grid grid-cols-1 gap-4 lg:grid-cols-[7fr_3fr]"
      >
        <div className="flex h-[600px] items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
          Mapbox + deck.gl mounts here in Stage 1.
        </div>
        <div className="flex h-[600px] items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
          Incident queue (shadcn Table) mounts here.
        </div>
      </section>
    </main>
  );
}
