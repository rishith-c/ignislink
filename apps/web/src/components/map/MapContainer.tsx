"use client";

// Server-safe entry point. Dynamically imports the Leaflet map with
// ssr: false so the bundle doesn't try to call `window` at build time.

import dynamic from "next/dynamic";
import type { MapIncident } from "./LeafletMap";

const LeafletMap = dynamic(() => import("./SentryMapClient"), {
  ssr: false,
  loading: () => (
    <div
      className="flex w-full items-center justify-center rounded-lg border border-border bg-zinc-950 text-sm text-muted-foreground"
      style={{ height: 540 }}
    >
      Loading map…
    </div>
  ),
});

export { LeafletMap };
export type { MapIncident };
