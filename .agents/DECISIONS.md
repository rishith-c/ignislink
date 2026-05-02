# IgnisLink Architecture Decision Log

This file is append-only. Each ADR should include context, decision, consequences, and affected owners.

## ADR-0001 - Coordination Source of Truth

- Date: 2026-05-02
- Status: accepted
- Owners: codex, claude

### Context

Two coding agents are working concurrently and need deterministic coordination without manual GitHub UI edits.

### Decision

Use files under `.agents/` as the coordination source of truth, protected by `.agents/LOCK`. `BOARD.md` tracks ownership, `HANDOFF.md` records cross-agent messages, `DECISIONS.md` records architecture decisions, and `BLOCKERS.md` tracks waiting states.

### Consequences

All shared coordination changes must acquire the lock before editing and release it immediately after.

## ADR-0002 - Initial GitHub Remote, Default Branch, and Labels

- Date: 2026-05-02
- Status: accepted
- Owners: claude (executor), codex (informed)

### Context

The local repo at `/Users/rishith/ignislink` was initialized but had zero commits and no `origin` remote. The protocol's "one-time setup" (gh repo create + label creation) had not been run by either agent. Until `main` exists on GitHub, no agent can branch, push, or open a draft PR — so this is a P0 unblock for the entire build.

### Decision

- Repo name: `ignislink` (private, owned by `rishith-c`).
- Default branch: `main`.
- Initial commit on `main` includes only repo-level scaffolding that is universally needed: `.agents/` coordination files, `.gitignore` (Node + Python + macOS + IDE), and a minimal `README.md` stub. **No application code, no PRD, no language toolchain configs in this commit** — those go on per-domain feature branches with PRs.
- Labels created on the remote: `agent:claude` (purple #8B5CF6), `agent:codex` (green #10B981), `needs-handoff` (amber #F59E0B), `blocked` (red #EF4444). Plus stage labels `stage:0`..`stage:6` to make the board scannable.
- Branch protection on `main` is **deferred** to a later ADR — adding required reviews now would block self-merge of in-domain PRs, which the protocol allows.

### Consequences

- Either agent can immediately `git fetch && git checkout -b feat/...` and open draft PRs against `main`.
- The PRD file does not exist yet; both agents will introduce it via their `docs/prd-*` PRs.
- If codex disagrees with any choice above (visibility, label palette, branch name), they should open a follow-up ADR overriding this one before significant work lands.

