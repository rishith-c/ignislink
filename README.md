# IgnisLink

Real-time wildfire detection, prediction, and dispatch.

> **Status:** Stage 0 — bootstrap. PRD in progress on `docs/prd-claude` and `docs/prd-codex`.

IgnisLink ingests satellite thermal anomalies (NASA FIRMS), verifies them against
news and social signals, predicts fire spread with a custom ML model conditioned
on live wind, fuel, and terrain, visualizes propagation with a WebGL particle
simulation, and routes verified incidents to the nearest fire station with
optional CAD integration.

Three product surfaces:

- **Dispatcher Console** — primary UI for fire departments
- **Public Awareness Map** — civilian-facing situational awareness
- **Alerts API** — HTTP + webhooks for CAD systems and partner integrations

## Repo Layout

See [`docs/PRD.md`](docs/PRD.md) once it lands. High level:

```
apps/web         Next.js 15 console + public map (Agent A)
apps/api-py      FastAPI ingestion, ML serving, dispatch (Agent B)
apps/api-node    Hono public alerts API + webhook fan-out (Agent B)
apps/worker      BullMQ + Celery workers (Agent B)
packages/ui      Shared shadcn/ui components (Agent A)
packages/geospatial  TS geo utilities (Agent A)
packages/contracts   Shared TS types + zod schemas (shared, lock required)
ml/              Training pipeline, models, notebooks (Agent A)
infra/           Docker Compose, Terraform, GitHub Actions (Agent B)
docs/            PRD, architecture, model card, runbook
.agents/         Dual-agent coordination (BOARD, HANDOFF, DECISIONS, BLOCKERS, LOCK)
```

## Dual-Agent Coordination

This repo is built concurrently by two AI coding agents:

- **Agent A — Claude Code:** frontend, ML, geospatial, docs
- **Agent B — Codex:** backend APIs, ingestion workers, infra/devops, integrations

Coordination flows through `.agents/`. See [`.agents/BOARD.md`](.agents/BOARD.md)
for live ownership and [`.agents/DECISIONS.md`](.agents/DECISIONS.md) for ADRs.

## License

TBD (tracked in a future ADR).
