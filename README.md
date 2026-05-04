# IgnisLink

Real-time wildfire detection, spread prediction, and dispatch routing. IgnisLink ingests satellite thermal anomalies from NASA FIRMS, verifies them against news and social signals, predicts fire spread with a custom ML model, and routes verified incidents to the nearest fire station.

**Status:** Stage 0, bootstrap. The PRD is complete. Application scaffolding is in progress.

## What it does

IgnisLink sits between NASA's satellite fire data and the people who dispatch fire crews. NASA FIRMS publishes thermal anomalies within about 3 minutes of satellite overpass, but most fire departments still learn about wildland fires from civilian 911 calls, which can come minutes to hours later. By that point, the pre-suppression window (the first 30 to 60 minutes when initial attack is most effective) has often closed.

IgnisLink closes that gap with a pipeline that works like this:

1. **Ingest.** Poll NASA FIRMS (VIIRS and MODIS) every 60 seconds for configured geographic bounding boxes. Normalize, deduplicate, and persist detections.
2. **Verify.** Query news and social sources to classify each detection as unreported, emerging, crews active, known prescribed burn, or likely industrial. This suppresses false positives from controlled burns, flares, and industrial heat sources.
3. **Enrich.** Build a 50 km by 50 km environmental context around the hotspot using NOAA HRRR weather data, USGS LANDFIRE fuel models, and SRTM elevation and terrain.
4. **Predict.** Feed the enriched context into a custom U-Net + ConvLSTM model that outputs per-pixel burn probability rasters at 1-hour, 6-hour, and 24-hour horizons, with probability isolines at 25%, 50%, and 75%.
5. **Dispatch.** Present verified incidents on a dispatcher console with the predicted fire footprint, wind conditions, the three nearest fire stations ranked by ETA, and a suggested upwind staging area. Dispatch requires a human to press the button. The system never auto-dispatches.

Three product surfaces expose this pipeline:

- **Dispatcher Console** (`/console`): the primary UI for fire departments. 70% map, 30% incident queue. Keyboard-driven. Dark mode by default. WCAG AA accessible.
- **Public Awareness Map** (`/`): civilian-facing, read-only. Shows verified fires and wind direction. No station info, no PII, no internal data.
- **Alerts API** (`/v1/alerts`): HTTP and signed webhooks for CAD systems and partner integrations.

## Why it is built this way

The architecture splits internal and public traffic. The internal Python (FastAPI) service handles FIRMS ingestion, ML inference orchestration, station lookup, and dispatch decisions, where correctness and geospatial library access matter most. The public Node.js (Hono) service handles the Alerts API and webhook fan-out, where horizontal scalability and strict redaction are the priorities. Shared TypeScript/Zod schemas in `packages/contracts` keep both sides in sync.

The fire-spread model uses a physics-informed approach. A Rothermel-based cellular automaton provides a deterministic baseline and also feeds rate-of-spread as an input feature to the neural model. The neural model is a U-Net with a ConvLSTM bottleneck (~24M parameters) trained on historical FIRMS detections, NIFC fire perimeters, and co-registered weather and fuel data. The primary metric is fire-front IoU: how well the predicted fire perimeter matches the observed one at each time horizon.

Durable state lives in PostgreSQL with PostGIS and TimescaleDB. Events use a transactional outbox pattern: event rows are written in the same transaction as state changes, then published to Redis for real-time delivery via Socket.IO, queues, and webhooks. Redis is cache and delivery infrastructure, never the system of record. This means a Redis outage does not lose data, and missed events can be replayed from the outbox.

Every dispatch is human-gated. The system surfaces verified context, predicted footprint, and nearest-station ranking, but a dispatcher must explicitly confirm before anything is sent to a fire station. This is a core safety constraint, not a feature toggle.

## Planned project structure

```
sentry_max/
  apps/
    web/                Next.js 15 dispatcher console + public awareness map
    api-py/             FastAPI: ingestion, ML serving, dispatch, admin
    api-node/           Hono: public Alerts API, webhook fan-out
    worker/             Celery (Python) + BullMQ (Node) background jobs
  packages/
    ui/                 Shared shadcn/ui components
    geospatial/         TypeScript geo utilities
    contracts/          Shared Zod schemas for events, DTOs, webhooks
  ml/
    models/             Rothermel baseline + U-Net + ConvLSTM fire-spread model
    data/               Training data pipeline (FIRMS, HRRR, LANDFIRE, SRTM)
  infra/
    docker-compose.yml  Local dev: PostGIS, Redis, all services
    terraform/          Production AWS infrastructure
  docs/
    PRD.md              Full product requirements document
  .agents/              Dual-agent coordination (board, handoff, decisions)
```

## Quickstart

This project is in early bootstrap. The PRD (`docs/PRD.md`) describes the full system. Application code is being scaffolded across multiple branches.

To follow along:

```bash
git clone https://github.com/yourusername/sentry_max.git
cd sentry_max

# Read the full PRD
open docs/PRD.md

# Check agent coordination status
open .agents/BOARD.md
```

Once scaffolding lands, the local development stack will be:

```bash
# Start all backend services
docker compose up

# Start the web frontend
cd apps/web && pnpm install && pnpm dev
```

## Screenshots / Demo

<!-- Add screenshot: the dispatcher console showing a map with FIRMS hotspots, predicted fire spread contours at 1h/6h/24h, and wind streamlines -->

<!-- Add screenshot: the incident queue with verification badges, FIRMS confidence, and dispatch buttons -->

<!-- Add screenshot: the incident detail sheet showing wind rose, ML contours, verification sources, and nearest stations with ETAs -->

<!-- Add screenshot: the public awareness map showing verified fires with civilian-friendly labels -->

## Key design decisions

- **Human-in-the-loop dispatch.** Even high-confidence verified incidents require a human to press "Dispatch." The system never auto-fires a webhook to a fire station.
- **Server-side redaction.** Public events are stripped of station details, exact coordinates, dispatch payloads, and FIRMS confidence scores at the API layer, not the client. Clients are assumed adversarial.
- **Verification is advisory.** The verification worker classifies detections, but a satellite detection is never deleted or hidden from dispatchers based on verification status.
- **Split backend.** Internal life-safety paths (FastAPI) are isolated from public partner traffic (Hono) so one cannot starve the other.
- **Transactional outbox.** Events are written in the same database transaction as state changes, making them durable and replayable without depending on Redis availability.

## License

TBD (tracked as an open ADR in `.agents/DECISIONS.md`).
