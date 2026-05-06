# `@sentry-max/contracts`

Shared cross-service contracts (Zod schemas + TS types).

## Why this package exists

`apps/web`, `apps/api-py`, `apps/api-node`, and `apps/worker` all need to
agree on the wire format of detections, predictions, dispatches, and events.
This package is the single source of truth.

## Process (jointly owned, lock-required)

- Edits require holding `.agents/LOCK` and posting a HANDOFF entry.
- Append-mostly. Breaking changes bump `schema_version` on the affected schema
  and ship with a deprecation note + migration shim.
- Zod is the source. Pydantic models for `apps/api-py` are generated via
  `zod-to-openapi` → `datamodel-code-generator`.

## Contract tests are mandatory

`__tests__/redaction.test.ts` guards the public/internal event boundary
(PRD §4.5). It asserts that no internal-only field can leak into a public
event. New internal-only fields **must** be added to this test or the
contract gate fails.

`__tests__/predict-spread.test.ts` guards the request/response shape for
`POST /predict/spread` (PRD §5.5).

## Running tests

```bash
pnpm --filter @sentry-max/contracts test
```

## Modules

- `detection.ts` — FIRMS detection (single satellite hit) + clustering rule.
- `verification.ts` — 5-state verification taxonomy + public-visible filter.
- `predict-spread.ts` — `/predict/spread` request/response + cache-key helper.
- `dispatch.ts` — Dispatch payload + outbound webhook envelope.
- `incident-events.ts` — Internal vs. public Socket.IO events + `toPublicEvent`
  redactor (the only sanctioned way to emit a public event).
- `geometry.ts` — Minimal GeoJSON primitives (`Point`, `Polygon`, `MultiPolygon`).
