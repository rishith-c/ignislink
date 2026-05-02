# IgnisLink — Product Requirements Document

> **Status:** v0 draft.
> §1–5 owned by Agent A (claude); drafted on `docs/prd-claude`.
> §6–10 owned by Agent B (codex); drafted on `docs/prd-codex`.
> Both PRs must merge before any feature work begins. After merge, this document becomes the canonical reference for every PR (`Refs: docs/PRD.md#<section>`).

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

IgnisLink shrinks the time between *"satellite saw heat"* and *"trucks rolling out of the firehouse."*

NASA FIRMS publishes thermal anomalies within ~3 minutes of satellite overpass. Today, most fire departments learn about a wildland fire from civilian 911 calls — minutes to hours later, after the fire is already established and after the **pre-suppression window** (the first 30–60 minutes when initial attack is most effective) has closed. IgnisLink ingests FIRMS in near-real-time, verifies each hotspot against news and social signals to suppress false positives (controlled burns, industrial flares, agricultural burns), predicts where the fire will go in the next 1, 6, and 24 hours using a custom-trained ML model conditioned on live wind / fuel / terrain, visualizes propagation as a live WebGL particle simulation, and routes the verified incident — with predicted spread, recommended staging area, and the three nearest stations ranked by ETA — directly to the dispatcher console and out to partner CAD systems.

IgnisLink is **not** a replacement for 911 or for human dispatch judgement. It is an **assistive surveillance and triage layer**: the satellite says *"something is hot here,"* and IgnisLink says *"here is the verified context, the predicted footprint, and the nearest crew."*

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

- **Replace 911.** Civilian calls remain the primary trigger; IgnisLink augments.
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
- **What IgnisLink does for them:** Surface fires that haven't been called in yet, with verification context + predicted footprint + nearest-station ranking on one screen. Single-click dispatch with a confirm modal.
- **Success criteria:**
  - Zero context-switch — every ICS-relevant field visible in the detail sheet without leaving the console.
  - Console operable end-to-end with keyboard alone (Cmd-K palette + single-letter shortcuts).
  - WCAG AA contrast even at midnight on a dimmed monitor.
- **Failure modes to avoid:** Pop-up alerts that interrupt ongoing radio traffic; counterintuitive map zoom that loses the active incident; modal stacking.

### 2.2 P2 — Civilian in or near a fire-prone WUI

- **Role:** Resident, traveler, journalist, evacuation planner.
- **Mental model:** Weather app, browser map, news feed.
- **What IgnisLink does for them:** Read-only awareness — active fires near a searched address, upwind direction (where embers are likely heading), verification status as a plain-English label ("reported by news outlets" / "satellite-only — unverified").
- **Success criteria:**
  - Address search → fires within 50 km within 1 second.
  - Mobile-first; usable on a 3G connection (static-tile fallback when MapboxGL fails).
  - WCAG AA; large tap targets.
- **What we deliberately omit:** No station rosters, no unit IDs, no internal verification provenance, no dispatch buttons. These would leak operational signal.

### 2.3 P3 — Fire Chief / Admin

- **Role:** Chief, deputy, IT lead at a fire department or regional dispatch center.
- **Mental model:** Configure rules, audit decisions, manage rosters, control rollout.
- **What IgnisLink does for them:**
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
- Disclaimer banner: *"IgnisLink is a situational tool. For evacuation orders, follow your local AHJ."*

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

## 6. Architecture *(Codex)*

> **Reserved for Agent B.** See PR `docs/prd-codex` for full content. Anchor expected: `#6-architecture`.
> Will describe: monorepo layout, service boundaries between `apps/web` / `apps/api-py` / `apps/api-node` / `apps/worker`, Redis pub/sub topology, Postgres + PostGIS + TimescaleDB schema overview, shared `packages/contracts/` Zod schema strategy.

## 7. APIs *(Codex)*

> **Reserved for Agent B.** Anchor: `#7-apis`.
> Will describe: FastAPI routes (ingestion, prediction, dispatch), Hono public alerts API, webhook signing, REST / WS error model, versioning, idempotency keys, rate limiting per partner key.

## 8. Infrastructure *(Codex)*

> **Reserved for Agent B.** Anchor: `#8-infrastructure`.
> Will describe: Docker Compose for local dev, Fly.io / Railway for staging, AWS ECS Fargate + RDS + S3 + CloudFront for prod, GitHub Actions CI matrix, Sentry + OpenTelemetry + Grafana wiring, secrets management (AWS Secrets Manager).

## 9. Integrations *(Codex)*

> **Reserved for Agent B.** Anchor: `#9-integrations`.
> Will describe: NASA FIRMS, NOAA HRRR + Open-Meteo, USGS LANDFIRE, Sentinel-2 (optional), ArcGIS Fire Stations, Mapbox Directions, Firecrawl + NewsAPI.ai + Exa, Twilio, RapidSOS IamResponding, APNs / FCM. Per-integration: auth, quota, retry strategy, circuit breaker thresholds.

## 10. Non-Functional Requirements *(Codex)*

> **Reserved for Agent B.** Anchor: `#10-nfrs`.
> Will describe: SLOs (echoing §1.1 metrics), retry / backoff policies, structured-log schema, trace / metric inventory, security posture (JWTs, signed webhooks, rate limits), data retention, disaster recovery, test strategy (unit / golden-file / Playwright / k6).

---

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
| v0 §1–5 | 2026-05-02 | claude | Initial draft on `docs/prd-claude`. §6–10 stubbed pending codex draft. |
