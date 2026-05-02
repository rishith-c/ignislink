# IgnisLink Agent Board

Last updated: 2026-05-02T16:29:02Z

## Protocol

- Agent A / Claude owns frontend, ML model, geospatial, docs sections 1-5.
- Agent B / Codex owns backend APIs, ingestion workers, infra/devops, integrations, PRD sections 6-10.
- Shared files require `.agents/LOCK` and a handoff note when the change affects the other agent.
- `whoami.log` writes are also lock-protected (confirmed in HANDOFF 2026-05-02T04:31:15Z and acknowledged 2026-05-02T04:40:23Z).

## Active Work

| Task | Owner | Branch | Status | Notes |
| --- | --- | --- | --- | --- |
| Draft PRD sections 6-10 | codex | docs/prd-codex | merged | PR #1 merged to `main`; content integrated into `docs/prd-integrate`. |
| Draft PRD sections 1-5 | claude | docs/prd-claude | integration PR open | Conflict-resolved integration branch `docs/prd-integrate` combines sections 1-5 and 6-10. |
| Stage-0 scaffold (monorepo + apps/web + packages/{ui,geospatial,contracts}) | codex+claude | feat/web/stage-0-scaffold | changes requested | Draft PR #3 open. Codex accepts not splitting contracts, but typecheck/geospatial failures must be fixed before undraft/merge. |
| Full application build acceleration | codex+claude | multiple | coordinating | User directed all agents to start and finish the full app, including model training. Immediate gate: merge PRD PRs, tag `v0.0.1-prd`, then parallelize Stage 0/1/3 work by ownership. |
| Earthquake hazard expansion PRD delta | codex+claude | docs/earthquake-expansion | PR #17 ready for review | User requested earthquake detection, shockwave impact visualization, scene status, and custom impact model. PRD update must merge before Stage 7/8 code starts. |

## Backlog

| Stage | Task | Owner | Status |
| --- | --- | --- | --- |
| 0 | Scaffold `apps/api-py`, `apps/api-node`, `apps/worker`, `infra/`, and CI | codex | pending until PRD approved |
| 0 | ~~Scaffold `apps/web`, `packages/ui`, `packages/contracts`, and docs shell~~ | claude | landed on PR #3 (draft) |
| 1 | FIRMS ingestion filters with tests first | codex | pending |
| 1 | Verification worker contracts with Agent A | codex | pending |
| 2 | FireContext enrichment schemas + `packages/contracts/predict-spread.ts` | shared | pending |
| 3 | ML model training pipeline + ONNX export | claude | pending after PRD merge |
| 4 | WebGL particle simulation prototype | claude | pending after PRD merge |
| 5 | Dispatch decision logic with tests first | codex | pending |
| 6 | AI Scout camera adapters | shared | pending |
| 7 | Earthquake USGS ingest, reconciliation, threat scoring, public/internal API contracts | codex | pending after PRD delta approval |
| 7 | Earthquake shockwave replay, impact rings, queue/detail UX | claude | pending after PRD delta approval |
| 8 | `quake-impact` model card, baseline, training labels, ONNX/export harness | claude | pending after PRD delta approval |
| 8 | `POST /predict/impact` route, cache, telemetry, degraded-mode handling | codex | pending after PRD delta approval |

## Immediate Critical Path

1. Merge PRD integration branch `docs/prd-integrate`.
2. Tag `v0.0.1-prd`.
3. Fix PR #3 contract/geospatial verification failures, then merge without splitting unless ownership concerns override the technical recommendation.
4. Codex starts backend Stage 0: `apps/api-py`, `apps/api-node`, `apps/worker`, `infra/docker-compose.yml`, CI.
5. Claude starts frontend console shell and ML scaffold/model-card in parallel after PRD merge.
6. Review and merge earthquake PRD delta before any Stage 7/8 earthquake implementation branches.
