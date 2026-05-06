// Fixture incidents for the dispatcher console. These match the IncidentInternalEvent
// shape from @sentry-max/contracts but are inlined here to keep the demo runnable without
// the live ingestion pipeline.

export type VerificationStatus =
  | "UNREPORTED"
  | "EMERGING"
  | "CREWS_ACTIVE"
  | "KNOWN_PRESCRIBED"
  | "LIKELY_INDUSTRIAL";

export type FirmsConfidence = "low" | "nominal" | "high";

export interface StationCandidate {
  id: string;
  name: string;
  agency: string;
  etaMinutes: number;
  distanceKm: number;
  /** Optional coordinates for map rendering — populated for the first three
   *  candidates per incident in the demo fixtures. */
  lat?: number;
  lon?: number;
}

export interface VerificationSource {
  kind: "news" | "social" | "scanner" | "registry";
  title: string;
  source: string;
  snippet: string;
  ageMinutes: number;
}

export interface FixtureIncident {
  id: string;
  shortId: string;
  lat: number;
  lon: number;
  county: string;
  state: string;
  neighborhood: string;
  observedAt: Date;
  ageMinutes: number;
  firmsConfidence: FirmsConfidence;
  brightTi4: number;
  fireRadiativePower: number;
  verification: VerificationStatus;
  windSpeedMs: number;
  windDirDeg: number;
  predictedSpread: { horizonMin: 60 | 360 | 1440; areaAcres: number; bearingDeg: number }[];
  stations: StationCandidate[];
  verificationSources: VerificationSource[];
}

const NOW = Date.now();
const m = (mins: number) => new Date(NOW - mins * 60_000);

export const FIXTURE_INCIDENTS: FixtureIncident[] = [
  {
    id: "ig_2026_05_02_001",
    shortId: "IG-2K91",
    lat: 38.6924,
    lon: -120.4148,
    county: "El Dorado",
    state: "CA",
    neighborhood: "Pollock Pines",
    observedAt: m(7),
    ageMinutes: 7,
    firmsConfidence: "high",
    brightTi4: 367.2,
    fireRadiativePower: 412.0,
    verification: "EMERGING",
    windSpeedMs: 6.2,
    windDirDeg: 245,
    predictedSpread: [
      { horizonMin: 60, areaAcres: 18, bearingDeg: 65 },
      { horizonMin: 360, areaAcres: 142, bearingDeg: 71 },
      { horizonMin: 1440, areaAcres: 980, bearingDeg: 78 },
    ],
    stations: [
      { id: "stn_eldorado_3", name: "Pollock Pines Station 28", agency: "El Dorado Cnty FD", etaMinutes: 6, distanceKm: 4.1, lat: 38.7619, lon: -120.4641 },
      { id: "stn_eldorado_5", name: "Camino Station 17", agency: "Cal Fire AEU", etaMinutes: 11, distanceKm: 9.4, lat: 38.7368, lon: -120.6747 },
      { id: "stn_eldorado_2", name: "Placerville HQ", agency: "El Dorado Cnty FD", etaMinutes: 14, distanceKm: 13.2, lat: 38.7296, lon: -120.7986 },
    ],
    verificationSources: [
      {
        kind: "news",
        title: "Smoke visible east of Pollock Pines, CHP responding",
        source: "Mountain Democrat",
        snippet: "CHP units have closed Sly Park Rd northbound after motorists reported a column of smoke...",
        ageMinutes: 4,
      },
      {
        kind: "scanner",
        title: "El Dorado FD dispatch — possible vegetation fire",
        source: "Broadcastify ELD-FIRE",
        snippet: "E28 responding code-3 to vicinity of Sly Park, smoke showing from drainage...",
        ageMinutes: 6,
      },
    ],
  },
  {
    id: "ig_2026_05_02_002",
    shortId: "IG-7HQ4",
    lat: 35.7621,
    lon: -120.6917,
    county: "Monterey",
    state: "CA",
    neighborhood: "Parkfield",
    observedAt: m(23),
    ageMinutes: 23,
    firmsConfidence: "nominal",
    brightTi4: 341.8,
    fireRadiativePower: 87.4,
    verification: "UNREPORTED",
    windSpeedMs: 3.1,
    windDirDeg: 290,
    predictedSpread: [
      { horizonMin: 60, areaAcres: 4, bearingDeg: 110 },
      { horizonMin: 360, areaAcres: 24, bearingDeg: 115 },
      { horizonMin: 1440, areaAcres: 180, bearingDeg: 120 },
    ],
    stations: [
      { id: "stn_mont_11", name: "Parkfield VFD", agency: "Monterey Cnty FD", etaMinutes: 14, distanceKm: 11.8 },
      { id: "stn_mont_3", name: "King City Station 1", agency: "Monterey Cnty FD", etaMinutes: 28, distanceKm: 32.1 },
      { id: "stn_mont_8", name: "Coalinga Station 33", agency: "Cal Fire BEU", etaMinutes: 31, distanceKm: 38.4 },
    ],
    verificationSources: [],
  },
  {
    id: "ig_2026_05_02_003",
    shortId: "IG-3MX2",
    lat: 44.0521,
    lon: -123.0868,
    county: "Lane",
    state: "OR",
    neighborhood: "Eugene foothills",
    observedAt: m(41),
    ageMinutes: 41,
    firmsConfidence: "high",
    brightTi4: 372.1,
    fireRadiativePower: 612.0,
    verification: "CREWS_ACTIVE",
    windSpeedMs: 4.5,
    windDirDeg: 200,
    predictedSpread: [
      { horizonMin: 60, areaAcres: 22, bearingDeg: 20 },
      { horizonMin: 360, areaAcres: 95, bearingDeg: 24 },
      { horizonMin: 1440, areaAcres: 410, bearingDeg: 28 },
    ],
    stations: [
      { id: "stn_lane_2", name: "Eugene-Springfield Station 9", agency: "Eugene-Springfield FR", etaMinutes: 8, distanceKm: 6.7, lat: 44.0306, lon: -123.0739 },
      { id: "stn_lane_5", name: "Lane FR District 1", agency: "Lane Fire Authority", etaMinutes: 12, distanceKm: 10.3, lat: 43.9621, lon: -123.0461 },
    ],
    verificationSources: [
      {
        kind: "news",
        title: "Crews battling 30-acre fire in Eugene foothills",
        source: "KEZI 9 News",
        snippet: "Eugene-Springfield Fire confirms 30 acres burning south of Mt. Pisgah; air attack en route...",
        ageMinutes: 22,
      },
      {
        kind: "social",
        title: "@LaneFireAuth: structure protection in progress",
        source: "X / Twitter",
        snippet: "Crews engaged in structure protection along S Willamette. Road closures: see pinned post.",
        ageMinutes: 18,
      },
    ],
  },
  {
    id: "ig_2026_05_02_004",
    shortId: "IG-5KP8",
    lat: 32.7157,
    lon: -117.1611,
    county: "San Diego",
    state: "CA",
    neighborhood: "Otay Mesa",
    observedAt: m(89),
    ageMinutes: 89,
    firmsConfidence: "low",
    brightTi4: 318.4,
    fireRadiativePower: 12.1,
    verification: "LIKELY_INDUSTRIAL",
    windSpeedMs: 2.8,
    windDirDeg: 270,
    predictedSpread: [],
    stations: [
      { id: "stn_sd_38", name: "San Diego Station 43", agency: "SDFD", etaMinutes: 9, distanceKm: 7.5 },
    ],
    verificationSources: [
      {
        kind: "registry",
        title: "Registered industrial flare zone (Otay Mesa S-1)",
        source: "Internal admin registry",
        snippet: "Persistent thermal anomaly site — refinery flare. Auto-suppress.",
        ageMinutes: 0,
      },
    ],
  },
  {
    id: "ig_2026_05_02_005",
    shortId: "IG-8LR3",
    lat: 39.5501,
    lon: -119.8483,
    county: "Washoe",
    state: "NV",
    neighborhood: "Peavine Mountain",
    observedAt: m(12),
    ageMinutes: 12,
    firmsConfidence: "high",
    brightTi4: 358.9,
    fireRadiativePower: 287.3,
    verification: "EMERGING",
    windSpeedMs: 9.4,
    windDirDeg: 225,
    predictedSpread: [
      { horizonMin: 60, areaAcres: 41, bearingDeg: 45 },
      { horizonMin: 360, areaAcres: 280, bearingDeg: 50 },
      { horizonMin: 1440, areaAcres: 1820, bearingDeg: 55 },
    ],
    stations: [
      { id: "stn_washoe_4", name: "Reno Station 11", agency: "Reno FD", etaMinutes: 9, distanceKm: 7.8, lat: 39.5283, lon: -119.8138 },
      { id: "stn_washoe_2", name: "Truckee Meadows Station 35", agency: "TMFR", etaMinutes: 14, distanceKm: 12.6, lat: 39.4856, lon: -119.7825 },
      { id: "stn_washoe_8", name: "Sparks Station 4", agency: "Sparks FD", etaMinutes: 17, distanceKm: 16.4, lat: 39.5388, lon: -119.7472 },
    ],
    verificationSources: [
      {
        kind: "social",
        title: "@RenoNVFD: Smoke reports west Reno, units responding",
        source: "X / Twitter",
        snippet: "Multiple smoke reports vicinity of Peavine. Units responding. Updates to follow.",
        ageMinutes: 9,
      },
    ],
  },
  {
    id: "ig_2026_05_02_006",
    shortId: "IG-9NB7",
    lat: 36.4906,
    lon: -118.5658,
    county: "Tulare",
    state: "CA",
    neighborhood: "Sequoia NF — registered burn",
    observedAt: m(54),
    ageMinutes: 54,
    firmsConfidence: "nominal",
    brightTi4: 339.2,
    fireRadiativePower: 64.7,
    verification: "KNOWN_PRESCRIBED",
    windSpeedMs: 1.8,
    windDirDeg: 180,
    predictedSpread: [],
    stations: [],
    verificationSources: [
      {
        kind: "registry",
        title: "Registered prescribed burn — USFS Sequoia NF Unit 12",
        source: "Internal admin registry",
        snippet: "Active prescribed burn 2026-05-01 → 2026-05-03. Auto-suppress.",
        ageMinutes: 0,
      },
    ],
  },
];

export function statusLabel(s: VerificationStatus): string {
  switch (s) {
    case "UNREPORTED":
      return "Unreported";
    case "EMERGING":
      return "Emerging";
    case "CREWS_ACTIVE":
      return "Crews active";
    case "KNOWN_PRESCRIBED":
      return "Prescribed burn";
    case "LIKELY_INDUSTRIAL":
      return "Industrial flare";
  }
}

export function statusColorClass(s: VerificationStatus): string {
  switch (s) {
    case "UNREPORTED":
      return "bg-zinc-700 text-zinc-100 border-zinc-600";
    case "EMERGING":
      return "bg-orange-600 text-white border-orange-500";
    case "CREWS_ACTIVE":
      return "bg-emerald-600 text-white border-emerald-500";
    case "KNOWN_PRESCRIBED":
      return "bg-blue-600 text-white border-blue-500";
    case "LIKELY_INDUSTRIAL":
      return "bg-purple-600 text-white border-purple-500";
  }
}
