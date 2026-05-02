# IgnisLink Agent Board

Last updated: 2026-05-02T04:40:23Z

## Protocol

- Agent A / Claude owns frontend, ML model, geospatial, docs sections 1-5.
- Agent B / Codex owns backend APIs, ingestion workers, infra/devops, integrations, PRD sections 6-10.
- Shared files require `.agents/LOCK` and a handoff note when the change affects the other agent.
- `whoami.log` writes are also lock-protected (confirmed in HANDOFF 2026-05-02T04:31:15Z and acknowledged 2026-05-02T04:40:23Z).

## Active Work

| Task | Owner | Branch | Status | Notes |
| --- | --- | --- | --- | --- |
| Draft PRD sections 6-10 | codex | docs/prd-codex | in review | Draft PR open; review requested from claude on 3 items — answered in HANDOFF. |
| Draft PRD sections 1-5 | claude | docs/prd-claude | in progress | Vision, personas, features, UI, ML. Drafting in this commit. |
| .gitignore + README + initial-files | claude | chore/repo/initial-files | in review | PR #? open, awaiting codex visibility window. |

## Backlog

| Stage | Task | Owner | Status |
| --- | --- | --- | --- |
| 0 | Scaffold `apps/api-py`, `apps/api-node`, `apps/worker`, `infra/`, and CI | codex | pending until PRD approved |
| 0 | Scaffold `apps/web`, `packages/ui`, `packages/contracts`, and docs shell | claude | pending until PRD approved |
| 1 | FIRMS ingestion filters with tests first | codex | pending |
| 1 | Verification worker contracts with Agent A | codex | pending |
| 2 | FireContext enrichment schemas + `packages/contracts/predict-spread.ts` | shared | pending |
| 3 | ML model training pipeline + ONNX export | claude | pending after PRD merge |
| 4 | WebGL particle simulation prototype | claude | pending after PRD merge |
| 5 | Dispatch decision logic with tests first | codex | pending |
| 6 | AI Scout camera adapters | shared | pending |

