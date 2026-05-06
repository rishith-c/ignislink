# SentryMax Python API (sentry hackathon backend)

FastAPI service that fronts the SENTRY hackathon stack:
* Postgres + PostGIS + TimescaleDB (detections, predictions, dispatches, earthquake_events, gauge_observations)
* Redis (15-min predict-cache + pub/sub)
* Kafka (KRaft) for ``detections.received`` and ``dispatches.sent`` events
* MinIO for context rasters + ML artifacts
* ONNX Runtime serving the bundled fire-spread weights

## Routes

| Method | Path                       | Notes                                                                     |
|--------|----------------------------|---------------------------------------------------------------------------|
| GET    | `/health`                  | Liveness                                                                  |
| GET    | `/ready`                   | DB + Redis + Kafka + ONNX checks                                          |
| GET    | `/detections?bbox=...`     | Bounding-box query, paginated via `limit` / `offset`                      |
| POST   | `/detections`              | Persist + emit Kafka `detections.received`                                |
| POST   | `/predict/spread`          | Matches `packages/contracts/src/predict-spread.ts`, 15-min Redis cache    |
| POST   | `/dispatch/{detection_id}` | Resource ranker + Kafka `dispatches.sent`                                 |
| GET    | `/earthquakes`             | Bbox + since query with Omori-Utsu / Gutenberg-Richter aftershock prior   |
| GET    | `/floods/gauges?state=ca`  | Latest gauge stage + 6h/24h/48h × p10/p50/p90 quantile forecast           |

## Local Commands

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"

# Run the full stack via Agent 1's compose. Once postgres/redis/kafka are up:
docker compose -f infra/docker-compose.yml up -d

# Or run the API standalone with no deps (degraded mode):
uvicorn sentry_max_api.main:app --reload

# Tests
pytest
```

## Environment

| Variable                | Default                                                            | Purpose                       |
|-------------------------|--------------------------------------------------------------------|-------------------------------|
| `DATABASE_URL`          | (none — degraded if unset)                                         | `postgresql+asyncpg://...`    |
| `REDIS_URL`             | (none)                                                             | `redis://...`                 |
| `KAFKA_BOOTSTRAP`       | (none)                                                             | `host:9092`                   |
| `ONNX_MODEL_PATH`       | `<repo>/ml/models/fire-spread-prod-candidate-bounded.onnx`         | Loaded at startup             |
| `MODEL_VERSION`         | `fire-spread-prod-candidate-bounded`                               | Tag included in responses     |
| `PREDICT_CACHE_TTL_SECONDS` | `900`                                                          | Redis TTL for predict cache   |
| `REQUIRE_DEPENDENCIES`  | `false`                                                            | Hard fail readiness if true   |
