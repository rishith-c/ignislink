# SENTRY data pipeline (`apps/worker`)

End-to-end ingestion pipeline for the SENTRY hackathon demo.

```
NASA FIRMS  ─┐
USGS Quakes ─┼─►  Async pollers ──► Kafka ──► Postgres+Timescale sinks
USGS Water  ─┘                       │
                                     ▼
                          Spark Structured Streaming
                          (1-min tumbling, geohash-5)
                                     │
                                     ▼
                             detections_agg_5min
```

## Layout

```
apps/worker/
├── pyproject.toml              # uv-managed; all data-pipeline deps live here
├── Dockerfile                  # python:3.12-slim + the `apps.worker` package
├── __main__.py                 # `python -m apps.worker` entrypoint
├── fixtures/                   # offline samples — used when keys are absent
├── migrations/                 # 0001 base, 0002 hypertables, 0003 aggregations
├── src/
│   ├── common/                 # config + structlog + geo + Kafka helpers
│   ├── sources/                # firms.py, usgs_quakes.py, usgs_water.py
│   ├── sinks/                  # postgres.py — Kafka → Postgres consumers
│   ├── spark/                  # aggregations.py — Structured Streaming job
│   └── main.py                 # asyncio orchestrator
└── tests/                      # pytest — dedup + parser coverage
```

The legacy Stage-0 Celery surface lives under `src/ignislink_worker/` and is
preserved so PR #14's webhooks don't break.

## Quick start

```bash
# 1. Bring up infra (Kafka + Postgres + Spark + MinIO).
docker compose -f infra/docker-compose.yml up -d
sleep 30

# 2. Apply migrations (idempotent).
psql "postgresql://sentry:sentry@localhost:5432/sentry" \
  -f apps/worker/migrations/0001_base_tables.sql \
  -f apps/worker/migrations/0002_hypertables.sql \
  -f apps/worker/migrations/0003_aggregations.sql

# 3. Install pipeline deps.
cd apps/worker
uv sync                # or: python -m venv .venv && pip install -e .

# 4. Start sources (publishes to Kafka).
KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
  python -m apps.worker --sources firms,quakes,water

# 5. In another shell, drain Kafka into Postgres.
KAFKA_BOOTSTRAP_SERVERS=localhost:9092 \
PG_DSN=postgresql://sentry:sentry@localhost:5432/sentry \
  python -m apps.worker --sinks postgres
```

Both invocations are idempotent — restart freely.

### `--sources` and `--sinks`

| Flag value | What runs |
|---|---|
| `--sources firms` | NASA FIRMS poller every 60 s |
| `--sources quakes` | USGS earthquake poller every 5 min |
| `--sources water` | USGS NWIS gauge stage every 15 min |
| `--sources firms,quakes,water` | all three concurrently |
| `--sinks postgres` | Kafka consumers that bulk-insert into Postgres |
| `--sources firms --sinks postgres` | end-to-end inside one process |

The orchestrator spawns each requested source/sink as an asyncio task.
`SIGINT` / `SIGTERM` triggers a graceful shutdown.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Comma-separated brokers. |
| `PG_DSN` | `postgresql://sentry:sentry@localhost:5432/sentry` | Used by the Postgres sinks. |
| `FIRMS_API_KEY` | _(unset)_ | When unset, the FIRMS poller falls back to `fixtures/firms_sample.csv` so the demo runs with no credentials. |
| `FIRMS_POLL_SECONDS` | `60` | Override the FIRMS poll cadence. |
| `QUAKES_POLL_SECONDS` | `300` | USGS earthquake cadence. |
| `WATER_POLL_SECONDS` | `900` | USGS NWIS cadence. |
| `FIRMS_DEDUP_WINDOW_HOURS` | `24` | Sliding dedup window. |
| `FIRMS_DEDUP_RADIUS_M` | `375.0` | VIIRS pixel footprint. |

## Spark Structured Streaming aggregation

The PySpark job in `src/spark/aggregations.py` reads `detections.created` from
Kafka, geohash-5 buckets every detection, and writes per-cell tumbling-window
counts (60 s by default) into the `detections_agg_5min` Timescale hypertable.

**Submit it:**

```bash
docker exec -it sentry-spark-master /opt/spark/bin/spark-submit \
  --master spark://spark-master:7077 \
  --packages org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.0,org.postgresql:postgresql:42.7.3 \
  /opt/jobs/aggregations.py
```

The infra `docker-compose.yml` mounts `apps/worker/src/spark` into `/opt/jobs`
on both spark-master and spark-worker, so the job is visible inside the
cluster without rebuilding the image. Driver/worker env defaults talk to
`kafka:9092` and `jdbc:postgresql://postgres:5432/sentry` — override via
`KAFKA_BOOTSTRAP_SERVERS`, `PG_JDBC_URL`, `PG_USER`, `PG_PASSWORD` if your
network differs.

Verify the aggregations are landing:

```bash
psql "postgresql://sentry:sentry@localhost:5432/sentry" -c \
  "SELECT window_start, geohash5, detection_count
   FROM detections_agg_5min ORDER BY window_start DESC LIMIT 10;"
```

## Tests

```bash
cd apps/worker
.venv/bin/python -m pytest tests/
```

Critical-path coverage:

- `tests/test_firms_dedup.py` — sliding-window dedup (radius + horizon),
  fixture round-trip, normalization edge cases.
- `tests/test_usgs_parse.py` — earthquake GeoJSON + NWIS JSON fixture
  parsing, missing-value handling, sentinel rejection.
- `tests/test_geo.py` — geohash + haversine reference-point sanity (Eiffel
  Tower precision-5 == `u09tu`).

## Docker

```bash
# From the repo root (build context = repo root).
docker build -f apps/worker/Dockerfile -t sentry-worker:dev .

# Run sources + sinks against the compose network.
docker run --rm --network sentry-hackathon_sentry-net \
  -e KAFKA_BOOTSTRAP_SERVERS=kafka:9092 \
  -e PG_DSN=postgresql://sentry:sentry@postgres:5432/sentry \
  sentry-worker:dev --sources firms,quakes,water --sinks postgres
```
