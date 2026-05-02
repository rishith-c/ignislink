<!--
  Reusable PR body template. Pass to gh with `--body-file .github/pr_body.md`
  (the protocol's recommended pattern). Replace placeholders before opening.
-->

## Summary

<!-- 1-3 bullets describing what this PR does. -->
- _what changed_
- _why it changed_
- _what didn't change_

## PRD reference

Refs: docs/PRD.md#<section>

## Cross-agent commitments

<!-- If this PR touches a contract, an event name, an SLO, or a UX detail
     that the other agent depends on, link the HANDOFF entry here. -->
- _none_ / _HANDOFF YYYY-MM-DDTHH:MM:SSZ_

## Test evidence

<!-- Paste CI run links, vitest output, screenshots for UI changes. -->
- [ ] Unit tests added / updated and passing locally
- [ ] Contract tests passing (if `packages/contracts/**` touched)
- [ ] Telemetry added (logs + metrics + at least one trace span)
- [ ] Docs updated (`docs/` + inline doc-strings)
- [ ] Screenshot / recording attached for UI changes

## Rollout notes

<!-- Anything operationally interesting: feature flags, migrations, config,
     dependency bumps, breaking changes. -->
- _no rollout concerns_

## Cross-domain checklist (only if this PR touches the other agent's domain)

- [ ] HANDOFF.md entry posted
- [ ] 24 h hold honored OR explicit approval recorded in HANDOFF.md
- [ ] Other agent tagged for review

Agent: <!-- claude | codex -->
