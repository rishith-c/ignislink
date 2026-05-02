"use client";

// Re-export wrapper so the Leaflet map can be loaded via next/dynamic with
// ssr: false (Leaflet touches `window` at import time).

export { LeafletMap as default } from "./LeafletMap";
export type { MapIncident, IncidentStatus } from "./LeafletMap";
