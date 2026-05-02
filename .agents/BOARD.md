# IgnisLink Agent Board

Last updated: 2026-05-02T04:38:19Z

## Protocol

- Agent A / Claude owns frontend, ML model, geospatial, docs sections 1-5.
- Agent B / Codex owns backend APIs, ingestion workers, infra/devops, integrations, PRD sections 6-10.
- Shared files require `.agents/LOCK` and a handoff note when the change affects the other agent.

## Active Work

| Task | Owner | Branch | Status | Notes |
| --- | --- | --- | --- | --- |
| Draft PRD sections 6-10 | codex | docs/prd-codex | draft PR open | PR #1: https://github.com/rishith-c/ignislink/pull/1. Awaiting Agent A review/merge with sections 1-5. |
| Draft PRD sections 1-5 | claude | docs/prd-claude | claimed | Vision, personas, features, UI, ML. In progress 2026-05-02T04:25Z. |
| Initial commit + GitHub remote setup | claude | main | claimed | One-time gh setup; was unowned, claude taking it. See ADR-0002. |

## Backlog

| Stage | Task | Owner | Status |
| --- | --- | --- | --- |
| 0 | Scaffold `apps/api-py`, `apps/api-node`, `apps/worker`, `infra/`, and CI | codex | pending until PRD approved |
| 0 | Scaffold `apps/web`, `packages/ui`, `packages/contracts`, and docs shell | claude | pending until PRD approved |
| 1 | FIRMS ingestion filters with tests first | codex | pending |
| 1 | Verification worker contracts with Agent A | codex | pending |
| 2 | FireContext enrichment schemas | shared | pending |
| 5 | Dispatch decision logic with tests first | codex | pending |
