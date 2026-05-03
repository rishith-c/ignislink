# SENTRY · IgnisLink

Real-time wildfire detection, prediction, and dispatch.

SENTRY ingests NASA FIRMS satellite thermal anomalies, cross-checks them with
the Cal Fire active-incidents feed and news/scanner signals, predicts fire
spread with a custom-trained ML model conditioned on live wind / fuel /
terrain, visualizes propagation with a canvas particle simulation on a real
slippy map, scores each fire across 5 threat dimensions, and routes verified
incidents to the nearest fire station ranked by ETA.

Three product surfaces:

- **Dispatcher Console** (`/console`) — primary ops UI for fire departments
- **Public Awareness Map** (`/`) — civilian situational awareness
- **Admin** (`/admin`) — bounding-box config, routing, model versions, audit

---

## Quick start (5 commands)

```bash
git clone https://github.com/rishith-c/ignislink.git
cd ignislink
cp .env.example .env.local       # then paste your FIRMS_API_KEY
pnpm install
pnpm --filter @ignislink/web dev
```

Open `http://localhost:3000`. The dev server auto-reloads on file save.

---

## Prerequisites

| Tool | Min version | How to install |
| --- | --- | --- |
| Node.js | 22.16 | `nvm install 22.16 && nvm use 22.16` (`.nvmrc` in repo) |
| pnpm | 9.12 | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |
| Python | 3.12 | `pyenv install 3.12.7 && pyenv local 3.12.7` (only if running ML) |
| Git | 2.40 | preinstalled on macOS |

Tested on macOS 25.4 (Apple Silicon) and Linux. Windows users: use WSL 2.

---

## Install

```bash
git clone https://github.com/rishith-c/ignislink.git
cd ignislink

# JS / TS deps for the web app + workspaces
pnpm install

# Python deps for the ML pipeline (only if running training / tests)
cd ml && pip install -r requirements.txt && cd ..
```

`pnpm install` provisions all workspaces in one shot — it covers `apps/web`,
`packages/contracts`, `packages/geospatial`, `packages/ui`.

---

## Environment

Copy the schema and fill in real values:

```bash
cp .env.example .env.local
cp .env.example apps/web/.env.local   # Next.js looks here for runtime env
```

`.env.local` is gitignored — never commit it.

### Keys you need to do anything

| Variable | Required for | Where to get it |
| --- | --- | --- |
| `FIRMS_API_KEY` | NASA FIRMS satellite cross-check | Free at https://firms.modaps.eosdis.nasa.gov/api/area/ |

### Keys for richer features (optional, all have free tiers)

| Variable | Feature | Where |
| --- | --- | --- |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox basemap (we ship CARTO/Esri/OSM as defaults) | https://account.mapbox.com |
| `FIRECRAWL_API_KEY` | News verification (Stage 1) | https://www.firecrawl.dev |
| `EXA_API_KEY` | Neural news/social search | https://exa.ai |
| `NEWSAPI_AI_KEY` | News event aggregator | https://www.newsapi.ai |
| `EARTHDATA_USERNAME` / `PASSWORD` | NASA SRTM elevation | https://urs.earthdata.nasa.gov |
| `MODAL_TOKEN_ID` / `SECRET` | Optional GPU compute for ML | https://modal.com |
| `TWILIO_*` / `RAPIDSOS_*` | Dispatch fan-out (Stage 5) | partner-issued |

Anything you don't set is gracefully no-op'd — the app runs fine on FIRMS
alone.

### No-key data sources used out of the box

These work without registration:
- NASA FIRMS — needs the free key above
- Cal Fire active incidents — `incidents.fire.ca.gov/umbraco/api/IncidentApi/List`
- NOAA HRRR (when wired in Stage 2) — public NOMADS
- Open-Meteo (HRRR fallback) — free
- USGS LANDFIRE — public WMS/WFS
- ArcGIS Fire Stations — public HIFLD layer
- CARTO Voyager / Esri WorldImagery / OpenTopoMap basemap tiles — free

---

## Run the web app

```bash
pnpm --filter @ignislink/web dev
```

- Dev server: `http://localhost:3000` (Next.js 15 with hot reload)
- Routes:
  - `/`         Public Awareness Map (read-only civilian view)
  - `/console`  Dispatcher Console (full ops UI)
  - `/admin`    Admin (bounding boxes, routing, model versions, audit, mute)
  - `/api/intel/[incident-id]`  Live intel JSON (FIRMS + Cal Fire + threat scoring)

The console seeds with 6 fixture incidents across CA / OR / NV so it renders
without any backend or live ingestion.

### Production build

```bash
pnpm --filter @ignislink/web build
pnpm --filter @ignislink/web start
```

Serves on port 3000 by default. Tested cold-start: ~12 s.

---

## Run the ML pipeline

The training, evaluation, and ONNX-export pipeline lives in `ml/`. *Note:
these targets currently land in PR #15 (`feat/ml/spread-model`); pull that
branch or check it out to run them until the PR merges.*

```bash
git checkout feat/ml/spread-model
pip install -r ml/requirements.txt

# Run the full test suite (44 tests, ~76 s on CPU)
python -m pytest ml/__tests__

# Run the synthetic-data smoke training run (~9 min on CPU; <2 min on GPU)
python -m ml.training.train --synthetic --max-epochs 2

# Export to ONNX (opset 17, verified roundtrip vs PyTorch)
python -m ml.training.export_onnx \
  --checkpoint ml/checkpoints/last.ckpt \
  --out ml/models/fire-spread-v0.onnx

# Eval per-horizon fire-front IoU on a held-out split
python -m ml.training.eval --checkpoint ml/checkpoints/last.ckpt
```

What the smoke training proves: the U-Net + ConvLSTM architecture
forward-passes, backprops through the weighted-BCE + Dice + FireFrontIoU
combined loss, and updates without NaN. **It does not produce a usable
real-world model** — that requires the FIRMS+HRRR+LANDFIRE archive (~hundreds
of GB) and an A100. See [`docs/ml-model-card.md`](docs/ml-model-card.md) for
intended use, limitations, and ecoregion coverage.

---

## Run the test suites

```bash
# TypeScript typecheck across all workspaces
pnpm --filter "@ignislink/*" typecheck

# Web app + packages tests
pnpm --filter "@ignislink/*" test

# Python ML tests (after `git checkout feat/ml/spread-model`)
python -m pytest ml/__tests__ -v
```

Critical test: `packages/contracts/__tests__/redaction.test.ts` is the
public/internal event redaction gate per PRD §4.5 — it must pass on every
commit that touches `packages/contracts/`.

---

## Project structure

```
ignislink/
├── apps/
│   └── web/                Next.js 15 — console + public map + admin (Agent A)
│       ├── src/app/        App Router routes
│       ├── src/components/ Map, console, intel-panel components
│       ├── src/lib/intel/  FIRMS + Cal Fire + threat scoring (server-side)
│       └── src/lib/        Fixtures, hooks, utils
├── packages/
│   ├── contracts/          Shared zod schemas + TS types (lock required)
│   ├── geospatial/         TS geo utils — bbox, geohash, wind rose
│   └── ui/                 Shared shadcn primitives + tokens
├── ml/                     Python ML pipeline — Rothermel + U-Net+ConvLSTM (Agent A)
│   ├── models/             rothermel.py, unet_convlstm.py
│   ├── training/           train, eval, dataset, losses, export_onnx
│   └── __tests__/          pytest suite
├── docs/
│   ├── PRD.md              Canonical product requirements (§1–10)
│   ├── ml-model-card.md    ML model card (mandatory pre-production)
│   └── runbook.md          On-call runbook
├── .agents/                Multi-agent coordination (BOARD, HANDOFF, etc.)
├── .env.example            Schema for all integration keys
└── README.md               This file
```

Backend (`apps/api-py`, `apps/api-node`, `apps/worker`) and infra
(`infra/`) live on Codex's parallel branch — see PR #18 (`feat/infra/stage-0-backend`).

---

## What goes where (PR / branch matrix)

| Component | Branch / PR | State |
| --- | --- | --- |
| Web app + console + intel + map | `feat/web/stage-0-scaffold` (#3) | Ready |
| ML pipeline (Rothermel, U-Net, training, ONNX) | `feat/ml/spread-model` (#15) | Draft |
| Backend (API, workers, infra) | `feat/infra/stage-0-backend` (#18) | Draft |
| Earthquake hazard expansion | `docs/earthquake-expansion` (#17) | Ready |
| PRD §1–5 (vision, personas, features, UI, ML) | `docs/prd-claude` (#2) | Ready |
| PRD §6–10 (architecture, APIs, infra, integrations, NFRs) | merged in #1 | Merged |

---

## Architecture in one paragraph

`apps/web` is a single Next.js 15 app serving the dispatcher console, public
awareness map, and admin under one umbrella. The map is **vanilla Leaflet**
with three free basemap layers (CARTO Dark Voyager, Esri WorldImagery,
OpenTopoMap) and a custom canvas overlay that runs a wind-driven particle
simulation in lat/lon space — particles re-project on every frame so they
move correctly with pan and zoom. ML predicted spread renders as nested
heel-anchored ellipses (1 h / 6 h / 24 h) oriented along the bearing
direction. Each incident's intel panel calls a Next.js Route Handler at
`/api/intel/[id]` which parallelizes (a) NASA FIRMS satellite cross-check
within a 25 km bbox, (b) Cal Fire's active-incidents feed match within
25 km, (c) crew-on-scene heuristic from scanner traffic, and (d) population
exposure from a bundled US-cities table. All four feed a 5-axis threat
scorer (`fireIntensity`, `populationThreat`, `containment`,
`controlledLikelihood`, `lethalRiskScore`) that produces the headline
LOW / MODERATE / HIGH / CRITICAL band with rationale strings.

---

## Coordination

This repo is built concurrently by two AI coding agents:

- **Agent A — Claude Code:** frontend, ML, geospatial, docs §1–5
- **Agent B — Codex:** backend APIs, ingestion workers, infra, integrations, docs §6–10

State flows through `.agents/`:

- [`.agents/BOARD.md`](.agents/BOARD.md) — live task ownership
- [`.agents/HANDOFF.md`](.agents/HANDOFF.md) — cross-agent messages
- [`.agents/DECISIONS.md`](.agents/DECISIONS.md) — ADRs
- [`.agents/BLOCKERS.md`](.agents/BLOCKERS.md) — waiting states

---

## Troubleshooting

**Web app won't compile** — Turbopack is disabled in the dev script because
it choked on cross-workspace tsconfig extends. Plain `next dev` is used; if
you want to force Turbopack: `next dev --turbopack` and remove
`experimental.typedRoutes` from `next.config.ts`.

**Map shows blank tiles** — your network is blocking CARTO / Esri / OSM. The
basemap toggle in the top-right of the map switches between the three
providers; one of them usually works.

**Hydration mismatch on `/console`** — was caused by `Date.now()` in render;
fixed in commit `4eaf85a`. If you see it again with a browser extension
(Kapture, etc.), the `<body>` already has `suppressHydrationWarning`.

**`FIRMS_API_KEY not configured` in `/api/intel`** — Next.js looks for
`apps/web/.env.local`, not the monorepo root. Copy the file:
```bash
cp .env.local apps/web/.env.local
```
Then restart `pnpm dev`.

**ML tests show "no tests ran"** — you're not on the `feat/ml/spread-model`
branch. `git checkout feat/ml/spread-model` first.

---

## License

TBD. Open a PR against `.agents/DECISIONS.md` to propose one.
