// Single source of truth for cross-service contracts.
//
// Process (per HANDOFF 2026-05-02T04:40:23Z + ADR pending):
//   - Shared between Agent A (claude / web + ml) and Agent B (codex / api + workers).
//   - Lock-required: edits must hold .agents/LOCK and post a HANDOFF entry.
//   - Append-mostly: breaking changes bump the schema's `version` field and
//     ship with a deprecation note in HANDOFF + a migration shim where feasible.
//   - Zod is the source. Pydantic models for apps/api-py are generated via
//     zod-to-openapi → datamodel-code-generator.
//   - Contract tests in __tests__/ are TDD-mandatory and run in CI on every PR
//     touching packages/contracts/**.

export * from "./detection.js";
export * from "./predict-spread.js";
export * from "./incident-events.js";
export * from "./verification.js";
export * from "./dispatch.js";
export * from "./geometry.js";
