# IgnisLink Product Requirements Document

Status: Agent B draft for sections 6-10  
Last updated: 2026-05-02  
Owners: Agent A / Claude for sections 1-5, Agent B / Codex for sections 6-10

## 1. Vision and Success Criteria

_Agent A owned. Reserved for product vision, target outcomes, and launch metrics._

## 2. Personas and Primary Workflows

_Agent A owned. Reserved for dispatcher, public viewer, administrator, and integration partner workflows._

## 3. Product Surfaces and Feature Scope

_Agent A owned. Reserved for Dispatcher Console, Public Awareness Map, Admin, and Alerts API user-facing behavior._

## 4. Frontend UX and Interaction Requirements

_Agent A owned. Reserved for console layout, map interactions, command palette, accessibility, animation, and UI states._

## 5. ML and Geospatial Prediction Requirements

_Agent A owned. Reserved for model architecture, training data, prediction artifacts, map layers, and simulation behavior._

## 6. Backend Architecture

### 6.1 Service Boundaries

IgnisLink uses a split backend so life-safety ingestion and dispatch remain isolated from public traffic:

- `apps/api-py`: Python 3.12 + FastAPI service for internal ingestion control, ML inference orchestration, detection management, dispatch decisions, station lookup, enrichment reads, and privileged admin APIs.
- `apps/api-node`: Node.js + Hono public Alerts API for partner reads, webhook subscriptions, webhook fan-out, request signing, and public rate limiting.
- `apps/worker`: Python Celery workers for FIRMS, HRRR/Open-Meteo, LANDFIRE, geocoding, verification, model preparation, and dispatch jobs; Node BullMQ workers for public webhook fan-out and partner delivery retries.
- `apps/web`: Agent A owned frontend consuming REST and Socket.IO events.
- `packages/contracts`: shared TypeScript/Zod schemas for event payloads, HTTP DTOs, and partner webhook payloads. Shared ownership requires lock and tests before behavior changes.

### 6.2 Data Flow

1. FIRMS polling jobs run every 60 seconds for configured bounding boxes.
2. Raw satellite rows are normalized, provenance-stamped, filtered, deduplicated, and persisted in PostgreSQL.
3. Transactional outbox rows are written in the same transaction as new durable state.
4. Event publishers relay committed outbox rows to Redis pub/sub, queues, webhooks, and Socket.IO bridges.
5. New detections enqueue verification and enrichment jobs.
6. Verification jobs query approved providers, classify the detection as `UNREPORTED`, `EMERGING`, or `CREWS_ACTIVE`, and emit `detection.verified`.
7. Enrichment jobs build a `FireContext` from weather, fuels, terrain, and cached raster sources, then emit `fire_context.ready`.
8. Prediction requests call Agent A's model artifact through `POST /predict/spread`, cache results for 15 minutes, and emit `prediction.ready`.
9. Dispatch decision jobs rank nearby stations, create an audit record, deliver through primary and fallback channels, and emit dispatch delivery events.

### 6.3 Persistence

PostgreSQL 16 with PostGIS and TimescaleDB is the system of record:

- `detections`: hotspot point geometry, observed timestamp, source, confidence, FRP, brightness, scan/track, county/neighborhood, verification status, dedupe group, and full provenance JSON.
- `fire_contexts`: detection id, weather grid metadata, raster object keys, feature vector summary, source timestamps, cache keys, and quality flags.
- `predictions`: detection id, model version, horizon, contour GeoJSON, raster object key, cache expiry, latency metrics, and input hash.
- `stations`: station geometry, agency metadata, capabilities, source, last refreshed timestamp, and availability flags when known.
- `dispatches`: detection id, payload snapshot, ranked station candidates, selected channel, delivery state, signed webhook metadata, and immutable audit fields.
- `webhook_subscriptions`: partner id, endpoint, secret reference, event filters, status, rate limit policy, and last delivery summary.
- `event_outbox`: durable event id, aggregate id, event type, schema version, payload, publish state, retry count, and timestamps.
- `audit_log`: append-only security, admin, dispatch, and partner API actions.

Timescale hypertables are used for high-volume detection observations, external-call telemetry, queue events, and delivery attempts. Large rasters and generated maps are stored in S3-compatible object storage and referenced by immutable object keys.

Object key conventions:

- Context rasters: `ml/context/{detection_id}/{weather_sample_at}.tif`.
- Prediction rasters: `ml/predictions/{detection_id}/{model_version}/{horizon_min}.tif`.
- Static dispatch maps: `dispatch/maps/{dispatch_id}/{rendered_at}.png`.
- Camera frames: `camera-frames/{camera_id}/{captured_at}.jpg`.
- Model artifacts: `models/fire-spread/{model_version}/{artifact_name}`.

### 6.4 Eventing and Realtime

Redis is used for cache, rate limits, distributed locks, pub/sub, and queue coordination. Redis is not the system of record. Events must be idempotent, sequence-aware, and versioned:

- `detection.created`
- `detection.verified`
- `fire_context.ready`
- `prediction.ready`
- `incident.internal.updated`
- `incident.public.updated`
- `dispatch.requested`
- `dispatch.sent`
- `dispatch.failed`
- `dispatch.delivery.updated`
- `system.integration.degraded`

Socket.IO bridges internal events to the Dispatcher Console. Public clients receive only `incident.public.updated`, a server-redacted event with no station details, private dispatch payloads, partner secrets, internal audit metadata, FIRMS confidence score, or exact hotspot coordinates. Reconnecting clients use event sequence numbers or a since-token to recover missed updates.

### 6.5 Failure Modes

The backend must prefer delayed, explicit state over silent failure:

- Third-party outages set source-specific degraded flags and enqueue bounded retries with exponential backoff and jitter.
- Duplicate FIRMS rows never create duplicate active incidents within the configured spatial/time threshold.
- Missing enrichment data can create a partial `FireContext` with quality flags, but prediction must not run without minimum wind, terrain, and fuel inputs.
- Redis outage does not lose durable state; outbox replay resumes publication after recovery.
- PostgreSQL outage halts ingestion and dispatch mutations and fails readiness checks.
- Dispatch cannot auto-send when verification, station lookup, idempotency, or payload signing fails. It must create an auditable blocked state.
- Webhook fan-out must not block ingestion, prediction, or console updates.

Acceptance criteria:

- Docker Compose runs PostGIS, Redis, FastAPI, Hono, Celery worker, Celery scheduler, and BullMQ worker.
- FastAPI and Hono expose `/health`, `/ready`, and `/metrics`.
- Service ownership and data ownership are documented with no overlapping write paths.
- All externally triggered mutations require idempotency keys.
- Spatial and time indexes are defined for detection, station, dispatch, and event-outbox queries.

## 7. API and Contract Requirements

### 7.1 Internal FastAPI

All internal APIs require short-lived JWTs or service credentials and emit OpenTelemetry traces.

| Method | Path | Purpose | Required behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness | Process-level health check. |
| `GET` | `/ready` | Readiness | Includes DB, Redis, queue, migration, and dependency degradation summary. |
| `GET` | `/metrics` | Metrics scrape | Prometheus-compatible metrics. |
| `GET` | `/detections` | Query detections | Supports bbox, status, source, confidence, and time window filters. |
| `GET` | `/detections/{id}` | Detection detail | Returns provenance, verification, context, prediction, and dispatch summary. |
| `POST` | `/detections/ingest/firms/run` | Manual FIRMS poll trigger | Admin only, idempotent by bbox and time window. |
| `POST` | `/detections/{id}/verify` | Verification trigger | Idempotent, enqueues job, returns current job state. |
| `POST` | `/detections/{id}/context` | Enrichment trigger | Builds or refreshes `FireContext`. |
| `POST` | `/predict/spread` | ML spread prediction | Returns the §5.5 contract: horizons at 1h, 6h, 24h with 25/50/75 percent contours, raster references, cache state, inference latency, and input hash. |
| `GET` | `/stations/nearby` | Station search | Requires bbox or radius query; internal only. |
| `POST` | `/dispatches` | Dispatch decision and delivery | Requires detection id, actor or automation policy, and idempotency key. |
| `GET` | `/dispatches/{id}/audit` | Dispatch audit read | Internal only; redacts partner secrets. |

### 7.2 Public Hono Alerts API

The public API is read-only except webhook subscription management. It must be horizontally scalable and isolated from internal services.

| Method | Path | Purpose | Required behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | Liveness | Process-level health check. |
| `GET` | `/ready` | Readiness | Includes Redis, DB read path, and dependency degradation summary. |
| `GET` | `/metrics` | Metrics scrape | Prometheus-compatible metrics. |
| `GET` | `/v1/alerts` | Public alert list | Redacted alerts by bbox, severity, status, and time window. |
| `GET` | `/v1/alerts/{id}` | Public alert detail | No PII, no station routing, no sensitive provenance. |
| `POST` | `/v1/webhooks/subscriptions` | Create subscription | API key required; stores secret reference only. |
| `GET` | `/v1/webhooks/subscriptions` | List subscriptions | Partner scoped. |
| `PATCH` | `/v1/webhooks/subscriptions/{id}` | Update subscription | Rotates signing secret through secrets manager flow. |
| `DELETE` | `/v1/webhooks/subscriptions/{id}` | Disable subscription | Soft-delete with audit log. |
| `POST` | `/v1/webhooks/test` | Test delivery | Sends signed test event to partner endpoint. |

Webhook deliveries use HMAC-SHA256 signatures over timestamp and raw body. Required headers:

- `X-IgnisLink-Timestamp`
- `X-IgnisLink-Signature`
- `X-IgnisLink-Event-Id`
- `X-IgnisLink-Schema-Version`

Receivers get stable event ids for idempotency. Replays outside a five-minute window must be rejected.

### 7.3 Authentication and Authorization

Roles:

- `viewer`: sanitized incident reads only.
- `dispatcher`: operational detection reads and dispatch actions.
- `admin`: system configuration, model pinning, routing rules, API key lifecycle, camera registry, and audit export.
- `integrator`: scoped Alerts API and webhook subscription access.
- `service`: service-to-service workflows with least-privilege credentials.

Dispatcher and admin users authenticate through an OIDC/SAML-ready identity provider. Local development may use seeded test users only. Access tokens are short-lived JWTs, refresh tokens rotate, and revocation is enforced for compromised accounts. Service-to-service credentials are separate from user authentication.

### 7.4 Contract Testing

`packages/contracts` must include schema tests before implementation for:

- FIRMS ingestion input normalization and confidence filtering.
- Detection, verification, fire context, prediction, incident, and dispatch event payloads.
- `POST /predict/spread` request and response payloads in `packages/contracts/predict-spread.ts`.
- Public alert DTO redaction.
- Webhook signature envelope.
- Dispatch payload shape with station ETA candidates and ML contours.
- API key scope enforcement.

Any contract change affecting Agent A requires a `HANDOFF.md` entry with migration notes and a 24-hour review hold unless explicitly approved.

## 8. Ingestion, Enrichment, and Integration Requirements

### 8.1 FIRMS Ingestion

FIRMS ingestion is the first life-safety path and must be test-first.

Acceptance criteria:

- Poll VIIRS URT and MODIS for configured bounding boxes every 60 seconds.
- Maintain source watermarks for each provider and bounding box.
- Normalize timestamps to UTC and geometries to WGS84 points.
- Reject malformed coordinates, malformed timestamps, and unsupported confidence values.
- Accept only `confidence >= nominal` unless an admin override is enabled for testing.
- Deduplicate against active detections from the last 24 hours within a 375 meter radius.
- Reverse-geocode accepted detections to county and neighborhood when providers are healthy.
- Persist raw source fields and derived fields in one transaction.
- Emit one `detection.created` outbox event per new active detection.
- Record poll latency, row count, accepted count, rejected count, duplicate count, stale-feed age, and provider errors.

### 8.2 Verification

Verification is advisory and never deletes a satellite detection.

Sources:

- Firecrawl for structured page extraction.
- Exa and NewsAPI.ai for recent web/news corroboration.
- Optional social or local agency feeds after explicit source approval.

Classification:

- `UNREPORTED`: no credible corroboration in the last 60 minutes.
- `EMERGING`: one or more credible local reports, unclear agency response.
- `CREWS_ACTIVE`: credible report indicates agency response or official incident activity.

Each verification result stores query text, source names, fetched timestamps, URL hashes, confidence rationale, classification version, and PII redaction state. Verification provider outages keep detections visible and pending human review.

### 8.3 Environmental Enrichment

For each eligible detection, build a 50 km by 50 km context centered on the hotspot:

- NOAA HRRR wind U/V, humidity, temperature when available.
- Open-Meteo fallback for weather gaps.
- Ten-day precipitation summary.
- USGS LANDFIRE fuel and vegetation rasters with aggressive spatial cache.
- SRTM elevation, slope, and aspect.
- 256 by 256 multi-channel raster bundle plus compact feature vector.

Quality flags must describe source freshness, fallback use, missing channels, interpolation method, and cache hit/miss. Prediction is blocked when minimum required channels are unavailable. Cached data may be used only when age metadata is attached.

### 8.4 Dispatch Integrations

Dispatch payloads include hotspot coordinates, FIRMS confidence, verification status, ML spread contours, nearest three stations with ETAs, suggested upwind staging area, and a static map reference.

Required channels:

- RapidSOS IamResponding webhook as primary where configured.
- Twilio SMS fallback for approved recipients.
- Email with static map fallback.
- Socket.IO push to console.

Every external dispatch attempt records signed payload hash, destination, response code, latency, retry count, and final state. Payload signing failures are hard failures. Dispatch logic must be idempotent by detection, event id, and idempotency key to prevent duplicate dispatch storms.

### 8.5 AI Scout Camera Network

Stage 6 camera adapters must be isolated behind an interface with provider-specific credentials and view-cone filters. Camera stills and classifier outputs are attachments to detections and dispatches, not prerequisites for FIRMS ingestion or initial dispatch.

## 9. Infrastructure and Operations

### 9.1 Local Development

Docker Compose must provide:

- PostgreSQL 16 with PostGIS and TimescaleDB extensions.
- Redis.
- FastAPI service.
- Hono service.
- Python Celery worker and scheduler.
- Node BullMQ worker.
- Optional MinIO-compatible object storage for local raster/map artifacts.

Local services must boot with sample bounding boxes, seed stations, health checks, named volumes, and mockable provider credentials. `.env.example` contains placeholders only. Real secrets are never committed.

Acceptance criteria:

- A fresh clone can run the local backend stack in under 10 minutes.
- Health checks report each core service.
- Seed data supports at least one realistic detection, one station search, and one webhook test without paid credentials.

### 9.2 CI

GitHub Actions must run on pull requests:

- Python lint, type check, and tests for `apps/api-py` and Python workers.
- Node lint, type check, and tests for `apps/api-node`, BullMQ workers, and shared contracts.
- Contract schema tests as a required job once `packages/contracts` exists.
- Docker build validation and Docker Compose smoke test for core service health.
- Database migration checks.
- Secret scanning and dependency vulnerability checks.

CI artifacts should include test reports and, when available, OpenAPI schema diffs. CI blocks broken contracts and migrations.

### 9.3 Environments

- Local: Docker Compose.
- Staging: Fly.io or Railway for rapid end-to-end validation from every green merge to `main`.
- Production: AWS ECS Fargate, RDS PostgreSQL with PostGIS/TimescaleDB, ElastiCache Redis, S3, CloudFront, managed secrets, and private networking.

Production deploys are by tagged release with manual approval. Infrastructure code lives under `infra/` and is Agent B owned. Production changes require rollback notes and an ADR when they alter topology, data stores, or public ingress.

### 9.4 Observability

Every service emits structured JSON logs with correlation ids, RED metrics, and OpenTelemetry traces. External call traces are required for NASA FIRMS, NOAA/Open-Meteo, ArcGIS, Mapbox, Twilio, RapidSOS, Firecrawl, Exa, and NewsAPI.ai.

Required dashboards:

- FIRMS poll freshness and latency.
- Detection acceptance, rejection, and dedupe rates.
- Verification provider latency and degradation.
- Enrichment cache hit rate and missing-channel rate.
- Prediction latency and cache hit rate.
- Dispatch delivery success, retry, and failure rates.
- Queue depth, worker lag, and dead-letter counts.
- Public API request rate, error rate, and throttling.
- DB saturation and Redis availability.

Alerts page on ingestion staleness, worker backlog, DB saturation, Redis outage, webhook failure spikes, provider degradation, and SLO burn rate. Sentry captures application errors with sensitive fields scrubbed before export.

### 9.5 Data Retention and Recovery

- Raw ingestion provenance: retain at least 24 months.
- Detection, prediction, and dispatch audit records: retain at least 7 years unless a deployment jurisdiction requires longer.
- Provider response bodies: store minimized metadata by default; store full excerpts only when legally permitted and operationally necessary.
- PostgreSQL backups: production point-in-time recovery, staging daily snapshots.
- Redis: treated as ephemeral except for replayable queues; durable event and audit records live in PostgreSQL.
- Object storage: immutable keys, versioning for model/raster artifacts, lifecycle policies by artifact class.

Restore drills must run before production launch and after major schema changes.

### 9.6 Rollout

Rollout uses feature flags for ingestion regions, verification providers, dispatch channels, prediction serving, public API access, and camera adapters.

Release order:

1. Read-only public alert and internal detection visibility mode.
2. Limited dispatcher pilot with manual dispatch confirmation.
3. Agency opt-in dispatch integrations.
4. Automated dispatch recommendations only after audit logs, agency validation, and manual override paths are proven.

Dispatch integrations must be disableable without redeploy.

## 10. Non-Functional Requirements and Release Gates

### 10.1 Performance SLOs

- FIRMS poll to database commit: p95 under 5 seconds after provider response.
- Detection to Dispatcher Console event: p95 under 90 seconds.
- Prediction inference route: p95 under 800 ms model runtime and under 2 seconds end-to-end when cache misses.
- Public Alerts API: p95 under 300 ms for cached bbox reads.
- Webhook fan-out: first delivery attempt within 10 seconds of eligible event.
- Public API uptime: 99.9 percent after production launch.

### 10.2 Reliability

- Ingestion, enrichment, verification, prediction, and dispatch jobs are idempotent.
- Third-party calls use timeouts, retry budgets, exponential backoff, jitter, and circuit breakers.
- Failed jobs move to dead-letter queues with replay tooling and operator-visible failure state.
- Public API overload must not starve internal ingestion or dispatch.
- Queue and event consumers must tolerate duplicate and out-of-order events.
- FIRMS outage marks the source degraded and never synthesizes detections.
- ML inference timeout or invalid output suppresses prediction attachment but preserves the detection workflow.

### 10.3 Security and Privacy

- Secrets live in a secrets manager or local untracked env files.
- Internal APIs require short-lived JWTs or service-to-service credentials.
- Public API keys are hashed server-side, prefix-identifiable for support, scoped, rate-limited, rotatable, and revocable.
- Webhook payloads are signed and include replay protection.
- Admin and dispatch actions are audit logged with actor, role/service, tenant/agency, timestamp, source IP where applicable, request id, action, target, outcome, and immutable payload summary.
- Public surfaces expose no PII, no internal station availability, no responder identity, no camera metadata, no partner secrets, and no private dispatch metadata.
- Address searches are not persisted unless explicitly needed for alert subscriptions.
- Logs and traces scrub tokens, API keys, phone numbers, emails, webhook secrets, and provider credentials.

### 10.4 Abuse and Rate Limits

- Public API uses per-key and per-IP rate limits.
- Auth endpoints use strict brute-force limits and lockout/backoff.
- Webhook fan-out uses per-partner concurrency limits, retries with exponential backoff, and dead-letter queues after max attempts.
- Bounding box expansion, dispatch channel enablement, model pinning, and routing rule changes are admin-only and audited.
- Load tests verify configured rate limits and graceful `429` responses.

### 10.5 Test Gates

Danger-zone tests must be written before implementation:

- FIRMS ingestion filters and spatial dedupe.
- Dispatch decision logic and idempotency.
- ML prediction output shape and sanity checks.
- Contract schemas in `packages/contracts`.
- Webhook signature verification and replay rejection.
- API key scope enforcement and public DTO redaction.
- Authorization tests for privilege escalation across roles.
- Log redaction tests for secrets and sensitive contact fields.

Release candidates require unit tests, integration tests for provider adapters with mocks, Docker Compose smoke tests, and k6 load checks for ingestion/public reads before production rollout.

### 10.6 Definition of Done

Each backend or integration feature is done only when:

- PRD section and acceptance criteria are linked in commit and PR body.
- Tests pass locally and in CI.
- Structured logs, metrics, and at least one trace span are present for new external calls or workflows.
- Docs and public API schema are updated.
- `BOARD.md` is updated, and `HANDOFF.md` contains migration notes for cross-agent changes.
- Branch is pushed, draft PR is opened, and the PR is marked ready only after local validation.
