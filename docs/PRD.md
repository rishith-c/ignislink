# SentryMax — Product Requirements Document

> **Status:** v0 integrated PRD.
> §1–5 owned by Agent A (claude); §6–10 owned by Agent B (codex).
> This document is the canonical reference for every implementation PR (`Refs: docs/PRD.md#<section>`).

## 0. Glossary

| Term | Definition |
| --- | --- |
| FIRMS | NASA Fire Information for Resource Management System. Near-real-time satellite thermal-anomaly feed (VIIRS S-NPP, NOAA-20, NOAA-21; MODIS Aqua/Terra). |
| URT | Ultra Real-Time. FIRMS variant published within ~3 min of overpass. |
| Detection / hotspot | A single thermal-anomaly point from FIRMS at a given timestamp. |
| Incident | One or more spatio-temporally-clustered detections that the system treats as the same fire. |
| HRRR | NOAA High-Resolution Rapid Refresh weather model. Hourly initialization, 3 km grid. |
| LANDFIRE | USGS dataset of fuel models, canopy cover, vegetation height. |
| Rothermel | Surface fire-spread equations from Rothermel (1972), the de-facto physics baseline. |
| Fire-front IoU | Intersection-over-union of predicted vs. observed fire perimeters at a time horizon — our primary ML metric. |
| WUI | Wildland-Urban Interface. |
| ICS | Incident Command System, the standard US emergency-response framework. |
| CAD | Computer-Aided Dispatch (Tyler New World, Hexagon, Central Square, etc.). |
| ETA payload | The dispatch artifact: hotspot coords, FIRMS confidence, verification status, predicted spread (1 h / 6 h / 24 h GeoJSON), 3 nearest stations + ETAs, suggested upwind staging area. |

---

## 1. Vision

SentryMax shrinks the time between *"satellite saw heat"* and *"trucks rolling out of the firehouse."*

NASA FIRMS publishes thermal anomalies within ~3 minutes of satellite overpass. Today, most fire departments learn about a wildland fire from civilian 911 calls — minutes to hours later, after the fire is already established and after the **pre-suppression window** (the first 30–60 minutes when initial attack is most effective) has closed. SentryMax ingests FIRMS in near-real-time, verifies each hotspot against news and social signals to suppress false positives (controlled burns, industrial flares, agricultural burns), predicts where the fire will go in the next 1, 6, and 24 hours using a custom-trained ML model conditioned on live wind / fuel / terrain, visualizes propagation as a live WebGL particle simulation, and routes the verified incident — with predicted spread, recommended staging area, and the three nearest stations ranked by ETA — directly to the dispatcher console and out to partner CAD systems.

SentryMax is **not** a replacement for 911 or for human dispatch judgement. It is an **assistive surveillance and triage layer**: the satellite says *"something is hot here,"* and SentryMax says *"here is the verified context, the predicted footprint, and the nearest crew."*

### 1.1 North-star metrics

| Metric | Target | Measurement |
| --- | --- | --- |
| **TTD** (time-to-dispatch) | p95 < 5 min | FIRMS overpass timestamp → dispatch payload delivered to nearest station |
| **TTV** (time-to-verification) | p95 < 90 s | Hotspot persisted → verification status assigned |
| **FIRMS poll → DB** | p95 < 5 s | Cron tick → row in `detections` |
| **False dispatch rate** | < 5 % | Crew-on-scene marks dispatch as "no fire" / "controlled" |
| **6 h fire-front IoU** | ≥ 0.55 | ML predicted perimeter vs. observed FIRMS perimeter @ +6 h, validation set |
| **24 h fire-front IoU** | ≥ 0.40 | Same, +24 h |
| **Console event-to-render** | p95 < 90 s | `detection.created` emitted → rendered in dispatcher console |
| **ML inference p95** | < 800 ms | `/predict/spread` server-side latency |
| **End-to-end predict** | p95 < 2 s | Hotspot ingest → contour GeoJSON visible in console |

### 1.2 Non-goals (v1)

- **Replace 911.** Civilian calls remain the primary trigger; SentryMax augments.
- **Provide official evacuation guidance.** The Public Awareness Map shows situational data only; the local AHJ remains authoritative for evacuation orders.
- **International coverage.** v1 scope is CONUS + AK / HI insofar as FIRMS, HRRR, LANDFIRE coverage allows. International is post-v1.
- **Replace ICS or CAD.** Integration is webhook-out, not replacement.
- **Indoor / structure fires.** Out of scope. The model is trained on wildland fire dynamics; structure-fire physics differ.
- **Prescribed-burn dispatch.** Verification should suppress these to `KNOWN_PRESCRIBED`, not dispatch.

### 1.3 Ethical & operational guardrails

- **Human-in-the-loop dispatch.** Even when verification is high-confidence, the dispatcher must explicitly press "Dispatch" — the system never auto-fires a webhook to a station without human action. (Auto-acknowledge for emerging incidents is an admin-toggleable feature, off by default, audit-logged.)
- **No PII on public surfaces.** The Public Awareness Map shows neither station rosters, unit IDs, nor responder identities.
- **Audit everything.** Every dispatch is recorded with the exact payload, who pressed the button, what predictions were attached, what model version produced them. Retention policy in §10 (Codex).
- **Bias in training data.** The FIRMS archive over-represents large/persistent fires. Documented in `docs/ml-model-card.md` with explicit rebalancing — see §5.2.

---

## 2. Personas

### 2.1 P1 — Dispatcher (primary)

- **Role:** 911 / CAD dispatcher or fire-department dispatch operator. Often on a 12-hour shift.
- **Mental model:** Tabular incident queue + situational map; single-click dispatch to crews.
- **Existing tools:** Tyler New World / Hexagon / Central Square CAD; ESRI / ArcGIS Dashboards; Active911; IamResponding; municipal radio.
- **Pain points:** Alert fatigue from low-confidence sources; latency between satellite confirmation and CAD entry; manual address-to-station lookup; no spread prediction at the moment of dispatch.
- **What SentryMax does for them:** Surface fires that haven't been called in yet, with verification context + predicted footprint + nearest-station ranking on one screen. Single-click dispatch with a confirm modal.
- **Success criteria:**
  - Zero context-switch — every ICS-relevant field visible in the detail sheet without leaving the console.
  - Console operable end-to-end with keyboard alone (Cmd-K palette + single-letter shortcuts).
  - WCAG AA contrast even at midnight on a dimmed monitor.
- **Failure modes to avoid:** Pop-up alerts that interrupt ongoing radio traffic; counterintuitive map zoom that loses the active incident; modal stacking.

### 2.2 P2 — Civilian in or near a fire-prone WUI

- **Role:** Resident, traveler, journalist, evacuation planner.
- **Mental model:** Weather app, browser map, news feed.
- **What SentryMax does for them:** Read-only awareness — active fires near a searched address, upwind direction (where embers are likely heading), verification status as a plain-English label ("reported by news outlets" / "satellite-only — unverified").
- **Success criteria:**
  - Address search → fires within 50 km within 1 second.
  - Mobile-first; usable on a 3G connection (static-tile fallback when MapboxGL fails).
  - WCAG AA; large tap targets.
- **What we deliberately omit:** No station rosters, no unit IDs, no internal verification provenance, no dispatch buttons. These would leak operational signal.

### 2.3 P3 — Fire Chief / Admin

- **Role:** Chief, deputy, IT lead at a fire department or regional dispatch center.
- **Mental model:** Configure rules, audit decisions, manage rosters, control rollout.
- **What SentryMax does for them:**
  - Bounding-box config for the FIRMS poller.
  - Alert routing rules (region → station list; time-of-day overrides).
  - Camera registry (Stage 6) with view-cone editor.
  - Model version pinning + rollback (§5.6).
  - Full audit log of every dispatch with replay.
- **Success criteria:** Defensible audit trail; ability to mute regions during planned burns.

### 2.4 P4 — Partner CAD / Integrator (external system)

- **Role:** RapidSOS IamResponding, Pulsepoint, municipal CAD vendor, county OES.
- **Interaction:** Signed webhook ingress (HMAC-SHA256 over body) + REST polling for replay.
- **Success criteria:**
  - Stable, versioned contract (`v1` namespace from day one).
  - Idempotent delivery keyed by `incident_id + dispatch_id`.
  - Replay endpoint covering last 30 days.
  - Per-key rate limiting documented; 429 with `Retry-After`.

---

## 3. Features

This section is the product surface — Codex's §6 (Architecture) and §7 (APIs) describe how each feature is realized in code. Acceptance criteria and telemetry expectations live on per-stage tracking issues, not in this PRD.

| ID | Feature | Stage | Owner | Surfaces in |
| --- | --- | --- | --- | --- |
| F1 | FIRMS detection ingest + dedup | 1 | Codex | All three |
| F2 | News / social verification | 1 | Codex | Console (badge) |
| F3 | Environmental enrichment (HRRR + LANDFIRE + SRTM) | 2 | Codex | Console (wind rose), ML pipeline |
| F4 | Fire-spread ML prediction | 3 | Claude (model) + Codex (route) | Console, Public Map, ETA payload |
| F5 | WebGL particle simulation | 4 | Claude | Console, Public Map |
| F6 | Routing & dispatch | 5 | Codex | Console, ETA payload, webhooks |
| F7 | AI Scout cameras (ONVIF / Pano / RTSP + YOLOv8) | 6 | Shared | Console, ETA payload |
| F8 | Dispatcher Console | 1+ (progressive) | Claude | `/console` |
| F9 | Public Awareness Map | 1+ | Claude | `/` |
| F10 | Admin | 5+ | Claude (UI) + Codex (rules engine) | `/admin` |

### 3.1 Feature dependencies

- F4 (ML) requires F3 (enrichment) for input features.
- F5 (particle sim) requires F3 (live wind grid) and F4 (predicted contours for color / lifetime).
- F6 (dispatch) requires F1+F2 (verification gate); F4 is an *enrichment* of dispatch payload, not a precondition.
- F7 (cameras) requires F6 so camera frames can be attached to the dispatch payload.

### 3.2 Verification taxonomy (F2)

The verification worker emits one of:

| Status | Meaning | Default routing |
| --- | --- | --- |
| `UNREPORTED` | Hotspot present, no corroborating news / social signals in 60 min radius. | Surface in console; do **not** auto-dispatch. |
| `EMERGING` | Hotspot + at least one corroborating signal (news, social, scanner) within 60 min. | Surface with badge; dispatcher decides. |
| `CREWS_ACTIVE` | Hotspot + at least one signal indicating crews on scene. | Informational only; dispatch suppressed by default. |
| `KNOWN_PRESCRIBED` | Hotspot inside a registered prescribed-burn polygon for the current window. | Suppressed entirely. |
| `LIKELY_INDUSTRIAL` | Hotspot inside a registered industrial-flare / hot-stack zone. | Suppressed by default; admin-overridable. |

Status assignment is best-effort — final dispatcher judgement is always required. Codex owns the worker; Claude owns the badge UI in the console (F8).

---

## 4. UI

> **Strict UI rules (non-negotiable):**
> - shadcn/ui primitives only — no MUI, no Chakra, no hand-rolled buttons / dialogs / tables.
> - Every new screen or component starts with a Magic MCP (`@21st-dev/magic`) generation, then is refined with shadcn primitives.
> - Tailwind CSS, Lucide icons, Framer Motion only.
> - Dark mode default; light mode supported.
> - WCAG AA minimum (contrast, focus rings, ARIA).
> - Keyboard-first: every action reachable from `Cmd-K` palette.

### 4.1 Dispatcher Console (`/console`)

**Layout:** 70 % map / 30 % incident queue (resizable via shadcn `Resizable`).

**Map (left, 70 %):**
- Mapbox GL JS base + deck.gl layers.
- Layers (toggleable, persisted to `localStorage`):
  1. FIRMS hotspots — clustered at low zoom, individual at high zoom; color by verification status.
  2. ML predicted contours — 25 / 50 / 75 % probability bands per horizon (1 h / 6 h / 24 h); horizon picker in legend.
  3. Wind streamlines — animated lines from HRRR U/V (F3).
  4. Particle simulation (F5) — 50–100 k particles advected by wind, color from burn-probability raster.
  5. Fire stations (ArcGIS) with 5 / 10 / 20-min isochrones from Mapbox Directions.
  6. Historical perimeter playback (timeline scrubber).
- Mini-map upper-right showing CONUS overview with active-incident pins.

**Incident queue (right, 30 %):**
- shadcn `Table`, sortable, filterable.
- Columns: ID short, lat/lon, FIRMS confidence, verification badge, age, nearest station, "Dispatch" button gated by verification.
- New rows animate in via Framer Motion (`y: -10 → 0`, 200 ms ease-out) without disrupting scroll position.
- Right-click a row → detail sheet.

**Detail sheet (shadcn `Sheet`, slides from right):**
- Header: incident ID, age, verification badge.
- Wind rose (custom SVG, animated by Framer) showing live wind direction + speed at the hotspot.
- ML contour toggle: per-horizon (1 h / 6 h / 24 h) overlay on main map, with confidence-band selector.
- Verification cards (top 3 corroborating sources from F2: title, source, snippet, link).
- Nearest-3-stations list with ETA, populated from F6.
- Suggested upwind staging-area marker.
- "Dispatch" button → shadcn `AlertDialog` confirm → triggers F6 webhook + audit log entry.
- "Mute incident" / "Mark resolved" / "Reassign" actions.

**Command palette (`Cmd-K`, shadcn `Command`) and global hotkeys** (committed to Codex in HANDOFF 2026-05-02T04:40:23Z; pushback welcome before Stage 8):
- `D` — Dispatch focused incident
- `V` — Open verification cards
- `M` — Mute incident
- `/` — Search by incident ID, address, station name
- `J` / `K` — Navigate queue (down / up; vim-style)
- `Esc` — Close detail sheet
- `?` — Keyboard shortcut reference

Horizon overlay toggle (1 h / 6 h / 24 h) is in the legend rather than the global hotkey set; it's incident-scoped, not global, and a hotkey would conflict with admin shortcuts that land in §4.3.

**Real-time:**
- Socket.IO connection on mount; reconnect with exponential backoff (1 s → 30 s cap).
- Events consumed: `detection.created`, `detection.updated`, `verification.completed`, `dispatch.completed`, `prediction.ready`.
- Toast on new high-confidence unverified hotspot (shadcn `Sonner`); audible chime gated by per-user setting.

**Theming & accessibility:**
- Dark mode default; midnight-shift palette toggle (further-dimmed background).
- All interactive elements ≥ 44 × 44 px (touch parity).
- Color-blind safe palette (deuteranomaly-tested): verification badges use shape + color, not color alone.
- Focus rings always visible; skip-to-content link.
- Tested at 1280 × 720, 1920 × 1080, 4 K, 3440 × 1440 ultra-wide.

### 4.2 Public Awareness Map (`/`)

- Read-only, civilian-friendly legend.
- Address search (Mapbox Geocoding) + browser geolocation prompt with explicit consent copy.
- Layers: active fires (verified only — `UNREPORTED` suppressed for civilian view in v1), wind direction; AQ index post-v1.
- No PII, no station info, no internal verification provenance.
- Mobile-first responsive layout.
- Static-tile fallback when MapboxGL fails (low-bandwidth, ad-blocker breaking GL).
- Disclaimer banner: *"SentryMax is a situational tool. For evacuation orders, follow your local AHJ."*

### 4.3 Admin (`/admin`)

- Auth-gated (Codex-owned auth; see §7).
- Sections:
  - **Bounding boxes** — list + edit (lat/lon polygon) for FIRMS poller; per-region cron interval.
  - **Routing rules** — region → station list; time-of-day overrides; on-call escalation.
  - **Camera registry** (Stage 6) — list cameras with view-cone editor (Mapbox draw plugin); test-frame preview.
  - **Model versions** — current pinned `fire-spread`; rollback with one click; A/B traffic split (post-v1).
  - **Audit log** — paginated table of dispatches + verification decisions; replay button.
  - **Mute regions** — temporary suppression for prescribed burns or known events.

### 4.4 Cross-cutting

- Layout primitive: shadcn `Resizable` panels persisted to `localStorage`.
- Telemetry: every page mount + key action emits a Sentry breadcrumb + an OpenTelemetry span.
- Error boundaries at every route + feature boundary; fallback shows a "report this" link with the trace ID.
- All user-visible strings in `apps/web/src/strings/` for future i18n (en-US only in v1).
- E2E: Playwright critical path = "console: receive new detection → see verification → dispatch → see audit entry."

### 4.5 Public ↔ internal event split (committed to Codex 2026-05-02T04:40:23Z)

Two parallel real-time event streams flow over Socket.IO with strict redaction at the API boundary. The Public Awareness Map (§4.2) subscribes only to `*.public.*`; the Dispatcher Console (§4.1) and Admin (§4.3) subscribe only to `*.internal.*`. Schemas live in `packages/contracts/` as `IncidentPublicEvent` and `IncidentInternalEvent`.

| Field | `incident.internal.updated` | `incident.public.updated` |
| --- | --- | --- |
| `incident_id` | full UUID | full UUID (already shareable) |
| Hotspot location | exact lat/lon | rounded to 500 m geohash |
| Verification status | `UNREPORTED` / `EMERGING` / `CREWS_ACTIVE` / `KNOWN_PRESCRIBED` / `LIKELY_INDUSTRIAL` | only `EMERGING` / `CREWS_ACTIVE` (others suppressed entirely from the public stream) |
| Predicted spread | full per-horizon GeoJSON @ 25/50/75 % | only the **t + 6 h, 50 %** ring |
| FIRMS confidence score | included | dropped |
| Locality | neighborhood/county string | county only |
| Station IDs / ETAs | included | dropped entirely |
| Dispatch payload | included | dropped entirely |
| Partner metadata | included | dropped entirely |

Redaction is enforced server-side at event emission, **not** at the client — clients must be assumed adversarial. A contract test in `packages/contracts/__tests__/redaction.test.ts` asserts no internal-only field can leak into a public event under any code path.

---

## 5. ML — Fire-Spread Model

> **Owner:** Claude (model author). Codex wires the inference route. Coordination on contract via `packages/contracts/predict-spread.ts` (lock required).

### 5.1 Goal & deliverables

**Problem:** Given a hotspot's location at time `t0`, plus a 50 km × 50 km grid of environmental context, predict per-pixel burn probability rasters at horizons `t0 + 1 h`, `t0 + 6 h`, `t0 + 24 h`.

**Outputs:**
- 3 × `GeoTIFF` rasters (one per horizon), 256 × 256, single channel, float32 ∈ [0, 1].
- 3 × GeoJSON `MultiPolygon` contour sets, one per horizon, at 25 / 50 / 75 % probability isolines.
- Confidence interval per horizon (model-card-derived, not per-prediction Bayesian — v1 simplification).

**Latency budget:** p95 < 800 ms server-side inference; p95 < 2 s end-to-end (ingest → contours visible in console).

### 5.2 Training data

| Source | Role | Coverage | Notes |
| --- | --- | --- | --- |
| FIRMS archive (VIIRS + MODIS) | Ground-truth fire presence | 2012 – present | Gridded to 375 m for VIIRS, 1 km for MODIS. Per-pixel "burning" labels. |
| NIFC Wildfire Perimeters | High-quality labeled perimeters | 2000 – present | Used for fire-front IoU eval and as "gold" perimeters for loss anchoring. |
| HRRR reanalysis | Wind U/V, humidity, temp | 2014 – present | 3 km grid, hourly. Co-registered to fire bounding box at burn time. |
| LANDFIRE (FBFM40, CBD, CC) | Fuel model, canopy bulk density, canopy cover | 2014, 2016, 2020, 2022 versions | Cached aggressively (tiles rarely change). |
| SRTM | Elevation, derived slope + aspect | Static | 30 m DEM, downsampled to model grid. |
| Open-Meteo historical | HRRR fallback | Global | Used for training samples outside HRRR coverage. |
| 10-day antecedent precip | Fuel-moisture proxy | Derived from HRRR / Open-Meteo | Aggregated rolling sum. |

**Sample construction:**
- For each historical fire ≥ 100 acres, generate sliding-window samples every hour from ignition to extinction.
- Window: 256 × 256 pixels at 30 m → 7.68 km × 7.68 km. (Smaller than the 50 km enrichment grid — the 50 km grid feeds environmental aggregates; the 256 × 256 is the prediction canvas.)
- Channels: current burn mask (binary), wind U, wind V, humidity, temperature, FBFM40 one-hot (40 channels — collapsed via embedding to 8 in-model), canopy cover, canopy bulk density, slope, aspect, days-since-precip.
- Label: future burn mask at `t + horizon`, soft-edged via Gaussian blur (σ = 1 px) so the loss tolerates small registration errors.

**Bias & rebalancing:**
- The FIRMS archive over-represents large, persistent, daytime fires (overpass schedule). We:
  - Undersample mature-stage time steps; oversample first-6h time steps.
  - Stratified split by ecoregion (Bailey's domains) — California chaparral, Pacific Northwest forest, Great Basin sage, Southwest desert, etc.
  - Document quantitative coverage in `docs/ml-model-card.md` (mandatory before any production deploy).
- Class imbalance (most pixels never burn): pixel-weighted BCE + Dice (see §5.3).

### 5.3 Architecture

**Baseline — Physics-informed cellular automata (Rothermel)**

Implemented first, for two reasons:
1. Sanity check — does this region's wind / fuel / terrain plausibly burn the way the data says?
2. Feature channel — Rothermel-derived rate-of-spread becomes an extra input to the neural model.

Code lives in `ml/models/rothermel.py`. Pure NumPy; deterministic; runs in ~50 ms per 256 × 256 grid. Calibrated against the BehavePlus reference outputs.

**Primary — U-Net + ConvLSTM**

```
Input:  (B, T, C, 256, 256)   T = 4 past time steps, C = 14 channels (see 5.2)
        |
        v
Encoder: 4 stages of (Conv2D + BatchNorm + GELU) × 2, downsample by 2 each
        |
        v
Bottleneck: ConvLSTM (hidden 256ch) over T past steps
        |
        v
Decoder: 4 stages mirroring encoder, with skip connections from encoder
        |
        v
Output head: 1×1 conv to 3 channels (one per horizon: 1h / 6h / 24h)
        |
        v
Sigmoid → per-pixel burn probability
```

- Channel order frozen in `packages/contracts/predict-spread.ts` so frontend / backend agree on raster interpretation.
- Mixed-precision training (bf16) on A100s.
- ~24 M parameters; ~92 MB ONNX export (post-quantization to int8 for serving: ~24 MB).

**Loss:**

```
L = α · BCE_weighted + β · DiceLoss + γ · FireFrontIoULoss
α = 1.0,  β = 0.5,  γ = 0.3
```

- BCE pixel-weighted by inverse class frequency per batch.
- Dice computed on the binarized prediction at threshold 0.5 (smooth Dice variant for differentiability).
- FireFrontIoULoss: 1 − IoU on the binarized perimeter (after morphological gradient).

**Metrics tracked:**
- Per-horizon fire-front IoU (primary).
- Mean burned-area absolute error (acres).
- Calibration: ECE on per-pixel probabilities.
- Inference latency p50 / p95 / p99 (CPU + GPU).

### 5.4 Pipeline

| Stage | Tool | Output |
| --- | --- | --- |
| Raw fetch | rioxarray + earthengine + boto3 | NetCDF / GeoTIFF in `ml/data/raw/` |
| Preprocess + co-register | xarray + rasterio.warp | NetCDF tiles in `ml/data/processed/` |
| Sharding | WebDataset | `.tar` shards in `ml/data/shards/` (S3 in prod) |
| Train | PyTorch + Lightning + MLflow | Checkpoints in `ml/checkpoints/`, runs in MLflow |
| Eval | PyTorch + custom IoU/AUC | Eval reports in `ml/eval/<run_id>/` |
| Export | torch.onnx + onnxruntime | `ml/models/fire-spread-<version>.onnx` |
| Register | MLflow Model Registry | Stage promotion: `Staging` → `Production` after sign-off |

**Compute:** v0 trains on Modal (or Lambda Labs A100) with 4 × A100 80 GB; ~6 hours per epoch on the full archive. Colab Pro is acceptable for v0.0 sanity runs only.

**MLflow tracking:** every run logs hyperparameters, train / val curves, validation IoU at each horizon, sample-batch visualizations (predicted contours over satellite RGB), git commit hash, dataset-shard hashes.

### 5.5 Serving

**Contract** (lives in `packages/contracts/predict-spread.ts`, jointly owned, lock-required — see HANDOFF 2026-05-02T04:40:23Z for the cross-agent commitment that fixed this shape):

```ts
// Request
POST /predict/spread
{
  detection_id: string,           // UUID of the originating FIRMS detection
  hotspot: GeoJSON.Point,         // [lon, lat]
  context_raster_key: string,     // S3 key of the pre-bundled FireContext raster (§3 / F3)
  wind_summary: {
    u_ms: number,                 // east-component wind velocity, m/s
    v_ms: number,                 // north-component wind velocity, m/s
    gust_ms: number,              // 10-min gust max, m/s
    sample_at: string             // ISO 8601, UTC; HRRR cycle timestamp used
  },
  horizons_min: number[]          // default: [60, 360, 1440] (1 h / 6 h / 24 h)
}

// Response
{
  model_version: string,          // matches MLflow registry tag
  generated_at: string,           // ISO 8601, UTC
  horizons: [
    {
      horizon_min: 60 | 360 | 1440,
      contours: {
        p25: GeoJSON.MultiPolygon,   // 25 % probability isoline
        p50: GeoJSON.MultiPolygon,   // 50 %
        p75: GeoJSON.MultiPolygon    // 75 %
      },
      raster_key: string             // S3 key of the GeoTIFF (signed-URL on demand)
    }
    // ... one entry per requested horizon, in input order
  ],
  inference_ms: number,
  cache_hit: boolean,
  input_hash: string              // SHA256(detection_id | model_version | wind_summary.sample_at | context_raster_key)
}
```

Pydantic models for `apps/api-py` are generated from the TS Zod schemas via `zod-to-openapi` → `datamodel-code-generator`. Contract tests in `packages/contracts/__tests__/` are TDD-mandatory (per the protocol's "danger zones") and run in CI on every PR touching `packages/contracts/**`. Breaking changes bump `version` and require a HANDOFF deprecation note.

**Cache:** key = `input_hash` (the SHA256 listed above). TTL 15 min. Invalidate on new HRRR cycle (which mints a new `wind_summary.sample_at`) or on a new model promotion (which mints a new `model_version`). The `input_hash` is also returned to clients so they can dedupe identical predictions across pages.

**S3 key conventions** (raster artifacts):
- Predictions: `ml/predictions/{detection_id}/{model_version}/{horizon_min}.tif`
- Context rasters (F3): `ml/context/{detection_id}/{wind_summary.sample_at}.tif`
- Bucket layout pinned by Codex in §6.3 — if it differs, this section follows.

**Failure modes:**
- HRRR unavailable → fall back to Open-Meteo (worse but live); response tags `context_source: 'open-meteo'`.
- ONNX runtime error → return 503 with `error: 'model_unavailable'`; the console gracefully renders without the contour layer.
- Latency exceeded → return what we have, partial-content (advisory; the dispatch flow does not block on prediction).

### 5.6 Monitoring & retraining

- **Drift detection:** weekly job compares the distribution of incoming feature vectors (wind speed, fuel-class mix, ecoregion) vs. training distribution; alert on KL divergence > threshold.
- **Performance dashboards:** Grafana panel of fire-front IoU computed retroactively against FIRMS observations 24 h after each prediction. Public to the team.
- **Retraining cadence:** monthly, with new FIRMS + perimeter data appended. Promotion `Staging` → `Production` requires:
  1. Held-out validation IoU ≥ current production model.
  2. No regression on per-ecoregion validation slices.
  3. Model card updated with new training-set bounds.
  4. Sign-off from Agent A (model author).
- **Rollback:** Admin UI (§4.3) → Model Versions → "Revert to <prior>"; takes effect within 5 min (cache eviction + ONNX re-load).
- **Model card:** `docs/ml-model-card.md` — mandatory; covers training data, intended use, limitations, ecoregion coverage, known failure modes.

---

## 6. Backend Architecture

### 6.1 Service Boundaries

SentryMax uses a split backend so life-safety ingestion and dispatch remain isolated from public traffic:

- `apps/api-py`: Python 3.12 + FastAPI service for internal ingestion control, ML inference orchestration, detection management, dispatch decisions, station lookup, enrichment reads, and privileged admin APIs.
- `apps/api-node`: Node.js + Hono public Alerts API for partner reads, webhook subscriptions, webhook fan-out, request signing, and public rate limiting.
- `apps/worker`: Python Celery workers for FIRMS, HRRR/Open-Meteo, LANDFIRE, geocoding, verification, model preparation, and dispatch jobs; Node BullMQ workers for public webhook fan-out and partner delivery retries.
- `apps/web`: Agent A owned frontend consuming REST and Socket.IO events.
- `packages/contracts`: shared TypeScript/Zod schemas for event payloads, HTTP DTOs, and partner webhook payloads. Shared ownership requires lock and tests before behavior changes.

### 6.2 Data Flow

1. FIRMS polling jobs run every 60 seconds for configured bounding boxes.
2. Raw satellite rows are normalized, provenance-stamped, filtered, deduplicated, and persisted in PostgreSQL.
3. Transactional outbox rows are written in the same transaction as new durable state.
4. Event publishers relay committed outbox rows to Redis pub/sub, queues, webhooks, and Socket.IO bridges.
5. New detections enqueue verification and enrichment jobs.
6. Verification jobs query approved providers, classify the detection as `UNREPORTED`, `EMERGING`, or `CREWS_ACTIVE`, and emit `detection.verified`.
7. Enrichment jobs build a `FireContext` from weather, fuels, terrain, and cached raster sources, then emit `fire_context.ready`.
8. Prediction requests call Agent A's model artifact through `POST /predict/spread`, cache results for 15 minutes, and emit `prediction.ready`.
9. Dispatch decision jobs rank nearby stations, create an audit record, deliver through primary and fallback channels, and emit dispatch delivery events.

### 6.3 Persistence

PostgreSQL 16 with PostGIS and TimescaleDB is the system of record:

- `detections`: hotspot point geometry, observed timestamp, source, confidence, FRP, brightness, scan/track, county/neighborhood, verification status, dedupe group, and full provenance JSON.
- `fire_contexts`: detection id, weather grid metadata, raster object keys, feature vector summary, source timestamps, cache keys, and quality flags.
- `predictions`: detection id, model version, horizon, contour GeoJSON, raster object key, cache expiry, latency metrics, and input hash.
- `stations`: station geometry, agency metadata, capabilities, source, last refreshed timestamp, and availability flags when known.
- `dispatches`: detection id, payload snapshot, ranked station candidates, selected channel, delivery state, signed webhook metadata, and immutable audit fields.
- `webhook_subscriptions`: partner id, endpoint, secret reference, event filters, status, rate limit policy, and last delivery summary.
- `event_outbox`: durable event id, aggregate id, event type, schema version, payload, publish state, retry count, and timestamps.
- `audit_log`: append-only security, admin, dispatch, and partner API actions.

Timescale hypertables are used for high-volume detection observations, external-call telemetry, queue events, and delivery attempts. Large rasters and generated maps are stored in S3-compatible object storage and referenced by immutable object keys.

Object key conventions:

- Context rasters: `ml/context/{detection_id}/{weather_sample_at}.tif`.
- Prediction rasters: `ml/predictions/{detection_id}/{model_version}/{horizon_min}.tif`.
- Static dispatch maps: `dispatch/maps/{dispatch_id}/{rendered_at}.png`.
- Camera frames: `camera-frames/{camera_id}/{captured_at}.jpg`.
- Model artifacts: `models/fire-spread/{model_version}/{artifact_name}`.

### 6.4 Eventing and Realtime

Redis is used for cache, rate limits, distributed locks, pub/sub, and queue coordination. Redis is not the system of record. Events must be idempotent, sequence-aware, and versioned:

- `detection.created`
- `detection.verified`
- `fire_context.ready`
- `prediction.ready`
- `incident.internal.updated`
- `incident.public.updated`
- `dispatch.requested`
- `dispatch.sent`
- `dispatch.failed`
- `dispatch.delivery.updated`
- `system.integration.degraded`

Socket.IO bridges internal events to the Dispatcher Console. Public clients receive only `incident.public.updated`, a server-redacted event with no station details, private dispatch payloads, partner secrets, internal audit metadata, FIRMS confidence score, or exact hotspot coordinates. Reconnecting clients use event sequence numbers or a since-token to recover missed updates.

### 6.5 Failure Modes

The backend must prefer delayed, explicit state over silent failure:

- Third-party outages set source-specific degraded flags and enqueue bounded retries with exponential backoff and jitter.
- Duplicate FIRMS rows never create duplicate active incidents within the configured spatial/time threshold.
- Missing enrichment data can create a partial `FireContext` with quality flags, but prediction must not run without minimum wind, terrain, and fuel inputs.
- Redis outage does not lose durable state; outbox replay resumes publication after recovery.
- PostgreSQL outage halts ingestion and dispatch mutations and fails readiness checks.
- Dispatch cannot auto-send when verification, station lookup, idempotency, or payload signing fails. It must create an auditable blocked state.
- Webhook fan-out must not block ingestion, prediction, or console updates.

Acceptance criteria:

- Docker Compose runs PostGIS, Redis, FastAPI, Hono, Celery worker, Celery scheduler, and BullMQ worker.
- FastAPI and Hono expose `/health`, `/ready`, and `/metrics`.
- Service ownership and data ownership are documented with no overlapping write paths.
- All externally triggered mutations require idempotency keys.
- Spatial and time indexes are defined for detection, station, dispatch, and event-outbox queries.

## 7. API and Contract Requirements

### 7.1 Internal FastAPI

All internal APIs require short-lived JWTs or service credentials and emit OpenTelemetry traces.

| Method | Path | Purpose | Required behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness | Process-level health check. |
| `GET` | `/ready` | Readiness | Includes DB, Redis, queue, migration, and dependency degradation summary. |
| `GET` | `/metrics` | Metrics scrape | Prometheus-compatible metrics. |
| `GET` | `/detections` | Query detections | Supports bbox, status, source, confidence, and time window filters. |
| `GET` | `/detections/{id}` | Detection detail | Returns provenance, verification, context, prediction, and dispatch summary. |
| `POST` | `/detections/ingest/firms/run` | Manual FIRMS poll trigger | Admin only, idempotent by bbox and time window. |
| `POST` | `/detections/{id}/verify` | Verification trigger | Idempotent, enqueues job, returns current job state. |
| `POST` | `/detections/{id}/context` | Enrichment trigger | Builds or refreshes `FireContext`. |
| `POST` | `/predict/spread` | ML spread prediction | Returns the §5.5 contract: horizons at 1h, 6h, 24h with 25/50/75 percent contours, raster references, cache state, inference latency, and input hash. |
| `GET` | `/stations/nearby` | Station search | Requires bbox or radius query; internal only. |
| `POST` | `/dispatches` | Dispatch decision and delivery | Requires detection id, actor or automation policy, and idempotency key. |
| `GET` | `/dispatches/{id}/audit` | Dispatch audit read | Internal only; redacts partner secrets. |

### 7.2 Public Hono Alerts API

The public API is read-only except webhook subscription management. It must be horizontally scalable and isolated from internal services.

| Method | Path | Purpose | Required behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness | Process-level health check. |
| `GET` | `/ready` | Readiness | Includes Redis, DB read path, and dependency degradation summary. |
| `GET` | `/metrics` | Metrics scrape | Prometheus-compatible metrics. |
| `GET` | `/v1/alerts` | Public alert list | Redacted alerts by bbox, severity, status, and time window. |
| `GET` | `/v1/alerts/{id}` | Public alert detail | No PII, no station routing, no sensitive provenance. |
| `POST` | `/v1/webhooks/subscriptions` | Create subscription | API key required; stores secret reference only. |
| `GET` | `/v1/webhooks/subscriptions` | List subscriptions | Partner scoped. |
| `PATCH` | `/v1/webhooks/subscriptions/{id}` | Update subscription | Rotates signing secret through secrets manager flow. |
| `DELETE` | `/v1/webhooks/subscriptions/{id}` | Disable subscription | Soft-delete with audit log. |
| `POST` | `/v1/webhooks/test` | Test delivery | Sends signed test event to partner endpoint. |

Webhook deliveries use HMAC-SHA256 signatures over timestamp and raw body. Required headers:

- `X-SentryMax-Timestamp`
- `X-SentryMax-Signature`
- `X-SentryMax-Event-Id`
- `X-SentryMax-Schema-Version`

Receivers get stable event ids for idempotency. Replays outside a five-minute window must be rejected.

### 7.3 Authentication and Authorization

Roles:

- `viewer`: sanitized incident reads only.
- `dispatcher`: operational detection reads and dispatch actions.
- `admin`: system configuration, model pinning, routing rules, API key lifecycle, camera registry, and audit export.
- `integrator`: scoped Alerts API and webhook subscription access.
- `service`: service-to-service workflows with least-privilege credentials.

Dispatcher and admin users authenticate through an OIDC/SAML-ready identity provider. Local development may use seeded test users only. Access tokens are short-lived JWTs, refresh tokens rotate, and revocation is enforced for compromised accounts. Service-to-service credentials are separate from user authentication.

### 7.4 Contract Testing

`packages/contracts` must include schema tests before implementation for:

- FIRMS ingestion input normalization and confidence filtering.
- Detection, verification, fire context, prediction, incident, and dispatch event payloads.
- `POST /predict/spread` request and response payloads in `packages/contracts/predict-spread.ts`.
- Public alert DTO redaction.
- Webhook signature envelope.
- Dispatch payload shape with station ETA candidates and ML contours.
- API key scope enforcement.

Any contract change affecting Agent A requires a `HANDOFF.md` entry with migration notes and a 24-hour review hold unless explicitly approved.

## 8. Ingestion, Enrichment, and Integration Requirements

### 8.1 FIRMS Ingestion

FIRMS ingestion is the first life-safety path and must be test-first.

Acceptance criteria:

- Poll VIIRS URT and MODIS for configured bounding boxes every 60 seconds.
- Maintain source watermarks for each provider and bounding box.
- Normalize timestamps to UTC and geometries to WGS84 points.
- Reject malformed coordinates, malformed timestamps, and unsupported confidence values.
- Accept only `confidence >= nominal` unless an admin override is enabled for testing.
- Deduplicate against active detections from the last 24 hours within a 375 meter radius.
- Reverse-geocode accepted detections to county and neighborhood when providers are healthy.
- Persist raw source fields and derived fields in one transaction.
- Emit one `detection.created` outbox event per new active detection.
- Record poll latency, row count, accepted count, rejected count, duplicate count, stale-feed age, and provider errors.

### 8.2 Verification

Verification is advisory and never deletes a satellite detection.

Sources:

- Firecrawl for structured page extraction.
- Exa and NewsAPI.ai for recent web/news corroboration.
- Optional social or local agency feeds after explicit source approval.

Classification:

- `UNREPORTED`: no credible corroboration in the last 60 minutes.
- `EMERGING`: one or more credible local reports, unclear agency response.
- `CREWS_ACTIVE`: credible report indicates agency response or official incident activity.

Each verification result stores query text, source names, fetched timestamps, URL hashes, confidence rationale, classification version, and PII redaction state. Verification provider outages keep detections visible and pending human review.

### 8.3 Environmental Enrichment

For each eligible detection, build a 50 km by 50 km context centered on the hotspot:

- NOAA HRRR wind U/V, humidity, temperature when available.
- Open-Meteo fallback for weather gaps.
- Ten-day precipitation summary.
- USGS LANDFIRE fuel and vegetation rasters with aggressive spatial cache.
- SRTM elevation, slope, and aspect.
- 256 by 256 multi-channel raster bundle plus compact feature vector.

Quality flags must describe source freshness, fallback use, missing channels, interpolation method, and cache hit/miss. Prediction is blocked when minimum required channels are unavailable. Cached data may be used only when age metadata is attached.

### 8.4 Dispatch Integrations

Dispatch payloads include hotspot coordinates, FIRMS confidence, verification status, ML spread contours, nearest three stations with ETAs, suggested upwind staging area, and a static map reference.

Required channels:

- RapidSOS IamResponding webhook as primary where configured.
- Twilio SMS fallback for approved recipients.
- Email with static map fallback.
- Socket.IO push to console.

Every external dispatch attempt records signed payload hash, destination, response code, latency, retry count, and final state. Payload signing failures are hard failures. Dispatch logic must be idempotent by detection, event id, and idempotency key to prevent duplicate dispatch storms.

### 8.5 AI Scout Camera Network

Stage 6 camera adapters must be isolated behind an interface with provider-specific credentials and view-cone filters. Camera stills and classifier outputs are attachments to detections and dispatches, not prerequisites for FIRMS ingestion or initial dispatch.

## 9. Infrastructure and Operations

### 9.1 Local Development

Docker Compose must provide:

- PostgreSQL 16 with PostGIS and TimescaleDB extensions.
- Redis.
- FastAPI service.
- Hono service.
- Python Celery worker and scheduler.
- Node BullMQ worker.
- Optional MinIO-compatible object storage for local raster/map artifacts.

Local services must boot with sample bounding boxes, seed stations, health checks, named volumes, and mockable provider credentials. `.env.example` contains placeholders only. Real secrets are never committed.

Acceptance criteria:

- A fresh clone can run the local backend stack in under 10 minutes.
- Health checks report each core service.
- Seed data supports at least one realistic detection, one station search, and one webhook test without paid credentials.

### 9.2 CI

GitHub Actions must run on pull requests:

- Python lint, type check, and tests for `apps/api-py` and Python workers.
- Node lint, type check, and tests for `apps/api-node`, BullMQ workers, and shared contracts.
- Contract schema tests as a required job once `packages/contracts` exists.
- Docker build validation and Docker Compose smoke test for core service health.
- Database migration checks.
- Secret scanning and dependency vulnerability checks.

CI artifacts should include test reports and, when available, OpenAPI schema diffs. CI blocks broken contracts and migrations.

### 9.3 Environments

- Local: Docker Compose.
- Staging: Fly.io or Railway for rapid end-to-end validation from every green merge to `main`.
- Production: AWS ECS Fargate, RDS PostgreSQL with PostGIS/TimescaleDB, ElastiCache Redis, S3, CloudFront, managed secrets, and private networking.

Production deploys are by tagged release with manual approval. Infrastructure code lives under `infra/` and is Agent B owned. Production changes require rollback notes and an ADR when they alter topology, data stores, or public ingress.

### 9.4 Observability

Every service emits structured JSON logs with correlation ids, RED metrics, and OpenTelemetry traces. External call traces are required for NASA FIRMS, NOAA/Open-Meteo, ArcGIS, Mapbox, Twilio, RapidSOS, Firecrawl, Exa, and NewsAPI.ai.

Required dashboards:

- FIRMS poll freshness and latency.
- Detection acceptance, rejection, and dedupe rates.
- Verification provider latency and degradation.
- Enrichment cache hit rate and missing-channel rate.
- Prediction latency and cache hit rate.
- Dispatch delivery success, retry, and failure rates.
- Queue depth, worker lag, and dead-letter counts.
- Public API request rate, error rate, and throttling.
- DB saturation and Redis availability.

Alerts page on ingestion staleness, worker backlog, DB saturation, Redis outage, webhook failure spikes, provider degradation, and SLO burn rate. Sentry captures application errors with sensitive fields scrubbed before export.

### 9.5 Data Retention and Recovery

- Raw ingestion provenance: retain at least 24 months.
- Detection, prediction, and dispatch audit records: retain at least 7 years unless a deployment jurisdiction requires longer.
- Provider response bodies: store minimized metadata by default; store full excerpts only when legally permitted and operationally necessary.
- PostgreSQL backups: production point-in-time recovery, staging daily snapshots.
- Redis: treated as ephemeral except for replayable queues; durable event and audit records live in PostgreSQL.
- Object storage: immutable keys, versioning for model/raster artifacts, lifecycle policies by artifact class.

Restore drills must run before production launch and after major schema changes.

### 9.6 Rollout

Rollout uses feature flags for ingestion regions, verification providers, dispatch channels, prediction serving, public API access, and camera adapters.

Release order:

1. Read-only public alert and internal detection visibility mode.
2. Limited dispatcher pilot with manual dispatch confirmation.
3. Agency opt-in dispatch integrations.
4. Automated dispatch recommendations only after audit logs, agency validation, and manual override paths are proven.

Dispatch integrations must be disableable without redeploy.

## 10. Non-Functional Requirements and Release Gates

### 10.1 Performance SLOs

- FIRMS poll to database commit: p95 under 5 seconds after provider response.
- Detection to Dispatcher Console event: p95 under 90 seconds.
- Prediction inference route: p95 under 800 ms model runtime and under 2 seconds end-to-end when cache misses.
- Public Alerts API: p95 under 300 ms for cached bbox reads.
- Webhook fan-out: first delivery attempt within 10 seconds of eligible event.
- Public API uptime: 99.9 percent after production launch.

### 10.2 Reliability

- Ingestion, enrichment, verification, prediction, and dispatch jobs are idempotent.
- Third-party calls use timeouts, retry budgets, exponential backoff, jitter, and circuit breakers.
- Failed jobs move to dead-letter queues with replay tooling and operator-visible failure state.
- Public API overload must not starve internal ingestion or dispatch.
- Queue and event consumers must tolerate duplicate and out-of-order events.
- FIRMS outage marks the source degraded and never synthesizes detections.
- ML inference timeout or invalid output suppresses prediction attachment but preserves the detection workflow.

### 10.3 Security and Privacy

- Secrets live in a secrets manager or local untracked env files.
- Internal APIs require short-lived JWTs or service-to-service credentials.
- Public API keys are hashed server-side, prefix-identifiable for support, scoped, rate-limited, rotatable, and revocable.
- Webhook payloads are signed and include replay protection.
- Admin and dispatch actions are audit logged with actor, role/service, tenant/agency, timestamp, source IP where applicable, request id, action, target, outcome, and immutable payload summary.
- Public surfaces expose no PII, no internal station availability, no responder identity, no camera metadata, no partner secrets, and no private dispatch metadata.
- Address searches are not persisted unless explicitly needed for alert subscriptions.
- Logs and traces scrub tokens, API keys, phone numbers, emails, webhook secrets, and provider credentials.

### 10.4 Abuse and Rate Limits

- Public API uses per-key and per-IP rate limits.
- Auth endpoints use strict brute-force limits and lockout/backoff.
- Webhook fan-out uses per-partner concurrency limits, retries with exponential backoff, and dead-letter queues after max attempts.
- Bounding box expansion, dispatch channel enablement, model pinning, and routing rule changes are admin-only and audited.
- Load tests verify configured rate limits and graceful `429` responses.

### 10.5 Test Gates

Danger-zone tests must be written before implementation:

- FIRMS ingestion filters and spatial dedupe.
- Dispatch decision logic and idempotency.
- ML prediction output shape and sanity checks.
- Contract schemas in `packages/contracts`.
- Webhook signature verification and replay rejection.
- API key scope enforcement and public DTO redaction.
- Authorization tests for privilege escalation across roles.
- Log redaction tests for secrets and sensitive contact fields.

Release candidates require unit tests, integration tests for provider adapters with mocks, Docker Compose smoke tests, and k6 load checks for ingestion/public reads before production rollout.

### 10.6 Definition of Done

Each backend or integration feature is done only when:

- PRD section and acceptance criteria are linked in commit and PR body.
- Tests pass locally and in CI.
- Structured logs, metrics, and at least one trace span are present for new external calls or workflows.
- Docs and public API schema are updated.
- `BOARD.md` is updated, and `HANDOFF.md` contains migration notes for cross-agent changes.
- Branch is pushed, draft PR is opened, and the PR is marked ready only after local validation.

## Appendix A — Open questions for cross-agent resolution

These need a HANDOFF discussion + ADR before the corresponding feature lands:

1. **Detection ↔ Incident clustering rule.** When do two FIRMS hits become one `Incident` vs. two? Proposed: same 24 h window AND ≤ 2 km apart AND no firebreak between (river / freeway / burn-scar). Owner: Codex (worker) + Claude (consumer). Action: ADR before Stage 1.
2. **`POST /predict/spread` 24 h-horizon reliability.** What does the console show when 24 h IoU on similar past fires is < 0.30 (i.e., we know the long-horizon prediction is unreliable)? Proposed: render with reduced opacity + "Low-confidence horizon" label. Owner: Claude (UI) + Codex (per-horizon reliability tagging in response). Action: ADR before Stage 3.
3. **Verification false-positive cost.** What's the dispatcher tolerance for `EMERGING` false positives? This drives the news-corroboration threshold in F2. Proposed: target precision ≥ 0.85 on `EMERGING`, i.e., at most 15 % of EMERGING-tagged incidents should turn out to be no-fire. Owner: Codex (worker) + Claude (badge UX). Action: ADR before Stage 1 ships.
4. **Public Map verification surface.** Do we show `UNREPORTED` (satellite-only) on the public map, or only `EMERGING+`? Suppression risks hiding a real fire from civilians; surfacing risks alarm. Proposed: `EMERGING+` only in v1, with an admin override per region. Owner: Claude. Action: ADR before §4.2 ships.
5. **Model-card publication.** Public or internal-only? Proposed: public — wildfire ML benefits from external scrutiny. Owner: Claude. Action: ADR before first production model promotion.
6. **License.** Repo currently has no LICENSE. Proposed: source-available with a non-commercial clause for v1; revisit pre-launch. Owner: shared. Action: ADR before any external commit.

## Appendix B — PRD revision history

| Version | Date | Author | Notes |
| --- | --- | --- | --- |
| v0 §1–5 | 2026-05-02 | claude | Initial draft on `docs/prd-claude`. |
| v0 §6–10 | 2026-05-02 | codex | Initial backend/API/infra/integrations/NFR draft merged in PR #1. |
| v0 integrated | 2026-05-02 | codex | Combined §1–5 and §6–10, preserving Appendix A ADR queue. |
