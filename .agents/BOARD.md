# SentryMax Agent Board

Last updated: 2026-05-04T23:16:24Z

## Protocol

- Agent A / Claude owns frontend, ML model, geospatial, docs sections 1-5.
- Agent B / Codex owns backend APIs, ingestion workers, infra/devops, integrations, PRD sections 6-10.
- Shared files require `.agents/LOCK` and a handoff note when the change affects the other agent.
- `whoami.log` writes are also lock-protected (confirmed in HANDOFF 2026-05-02T04:31:15Z and acknowledged 2026-05-02T04:40:23Z).

## Active Work

| Task | Owner | Branch | Status | Notes |
| --- | --- | --- | --- | --- |
| Initial PRD integration | codex+claude | docs/prd-integrate | complete | PR #16 merged; tag `v0.0.1-prd` pushed. PR #1/#2 superseded by the integrated PRD. |
| Stage-0 scaffold (monorepo + apps/web + packages/{ui,geospatial,contracts}) | codex+claude | feat/web/stage-0-scaffold | in review | Draft PR #3 rebased onto `main`; package gates fixed through `6b63ff8`; latest coordination/web sync included. |
| Full application build acceleration | codex+claude | multiple | coordinating | User directed all agents to start and finish the full app, including model training. PRD gate is complete; next Codex path is backend/worker/infra Stage 0, while Claude continues frontend/ML. |
| Forge/SENTRY console UI pass | codex | feat/web/forge-sentry-ui | draft PR #19 updated | Cross-domain user-requested pass applying the fetched Forge handoff to `/console`: full-screen app shell, no desktop traffic lights/margins, non-overlapping map controls, live Open-Meteo environmental enrichment, shadcn controls, map polish, and cleanup of web build warnings. |

## Backlog

| Stage | Task | Owner | Status |
| --- | --- | --- | --- |
| 0 | Scaffold `apps/api-py`, `apps/api-node`, `apps/worker`, `infra/`, and CI | codex | ready |
| 0 | ~~Scaffold `apps/web`, `packages/ui`, `packages/contracts`, and docs shell~~ | claude | landed on PR #3 (draft) |
| 1 | FIRMS ingestion filters with tests first | codex | pending |
| 1 | Verification worker contracts with Agent A | codex | pending |
| 2 | FireContext enrichment schemas + `packages/contracts/predict-spread.ts` | shared | pending |
| 3 | ML model training pipeline + ONNX export | claude | pending after PRD merge |
| 4 | WebGL particle simulation prototype | claude | pending after PRD merge |
| 5 | Dispatch decision logic with tests first | codex | pending |
| 6 | AI Scout camera adapters | shared | pending |

## Immediate Critical Path

1. Keep PR #3 current and merge once Claude confirms the cross-domain package hardening.
2. Codex starts backend Stage 0: `apps/api-py`, `apps/api-node`, `apps/worker`, `infra/docker-compose.yml`, CI.
3. Claude continues frontend console/map and ML scaffold/model-card in parallel.
4. After Stage 0 merges, Codex begins Stage 1 FIRMS ingestion with tests first.
