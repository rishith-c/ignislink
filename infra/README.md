# SENTRY Hackathon Data Infrastructure

Single-host docker-compose stack for the multi-hazard early-warning platform.
Brings up everything needed for ingestion, persistence, real-time messaging,
object storage, and Spark batch jobs.

## Quick Start

```bash
docker compose -f infra/docker-compose.yml up -d
sleep 30                                                  # let Kafka + Postgres warm up
docker compose -f infra/docker-compose.yml ps
```

After ~30 s you should see all services `Up (healthy)` and the `kafka-init` /
`minio-init` containers in state `Exited (0)` (one-shot bootstrap).

Validate the compose file without booting anything:

```bash
docker compose -f infra/docker-compose.yml config >/dev/null
```

Tear it all down (and wipe volumes):

```bash
docker compose -f infra/docker-compose.yml down -v
```

## Port Map

| Service        | Host port | Container port | Purpose                              |
| -------------- | --------- | -------------- | ------------------------------------ |
| Postgres       | 5432      | 5432           | PostGIS + TimescaleDB                |
| Redis          | 6379      | 6379           | Cache + pub/sub                      |
| Kafka          | 9092      | 9092           | Broker (PLAINTEXT)                   |
| MinIO API      | 9000      | 9000           | S3-compatible object store           |
| MinIO Console  | 9001      | 9001           | Web UI                               |
| Spark Master   | 8080      | 8080           | Spark master web UI                  |
| Spark Master   | 7077      | 7077           | Spark RPC / job submission           |

Default credentials (dev only — rotate before production):

- Postgres: `sentry / sentry` on database `sentry`
- MinIO: `sentry / sentry-dev-password`

## Inspect Postgres

```bash
docker compose -f infra/docker-compose.yml exec postgres \
    psql -U sentry -d sentry -c "\dt"

# Confirm extensions
docker compose -f infra/docker-compose.yml exec postgres \
    psql -U sentry -d sentry -c "SELECT extname, extversion FROM pg_extension;"

# Peek at fixture data
docker compose -f infra/docker-compose.yml exec postgres \
    psql -U sentry -d sentry -c "SELECT locality->>'shortId' AS short, sensor, confidence, frp_mw FROM detections ORDER BY observed_at DESC;"
```

## Attach to Spark Master

The master web UI is at <http://localhost:8080>.

```bash
# Open an interactive shell on the master container
docker compose -f infra/docker-compose.yml exec spark-master bash

# Submit a Python job from your host (with pyspark installed locally)
spark-submit --master spark://localhost:7077 path/to/job.py
```

## Inspect Kafka

```bash
# List topics
docker compose -f infra/docker-compose.yml exec kafka \
    kafka-topics.sh --bootstrap-server localhost:9092 --list

# Tail a topic
docker compose -f infra/docker-compose.yml exec kafka \
    kafka-console-consumer.sh --bootstrap-server localhost:9092 \
    --topic detections.created --from-beginning --max-messages 5
```

Topic catalog (created automatically by `kafka-init` from `kafka/topics.sh`):

| Topic                  | Partitions | Retention   | Purpose                          |
| ---------------------- | ---------- | ----------- | -------------------------------- |
| `detections.created`   | 6          | 7 days      | Raw FIRMS hotspots               |
| `detections.verified`  | 6          | 7 days      | Post-rule + LLM verification     |
| `predictions.ready`    | 3          | 3 days      | Spread-model outputs             |
| `dispatches.sent`      | 3          | 7 days      | Outbound dispatch envelopes      |
| `earthquakes.observed` | 3          | 30 days     | USGS earthquake feed             |
| `gauges.stage`         | 6          | 7 days      | NOAA / USGS stream-gauge feed    |

## MinIO Buckets

Bootstrapped on first boot by `minio-init`:

- `ml-artifacts` — model weights, ONNX exports, training metadata
- `raster-cache` — fuel / wind / terrain GeoTIFFs
- `training-shards` — WebDataset tar shards

## Migrations

SQL files in `sql/` are mounted into the postgres container and applied in
lexical order on first boot:

- `0001_init.sql` — schema, hypertables, spatial indexes
- `0002_seed.sql` — six wildfire fixtures (IG-2K91 … IG-9NB7), three
  earthquakes, two gauges, and an audit-log marker

Re-running the migrations against an existing volume is a no-op
(everything is gated on `IF NOT EXISTS` / `ON CONFLICT`).

## Resource Budget

Reasonable defaults for a 16 GB / 8-core dev box:

| Container       | CPU | Memory |
| --------------- | --- | ------ |
| postgres        | 2.0 | 2 Gi   |
| redis           | 0.5 | 512 Mi |
| kafka           | 1.5 | 1.5 Gi |
| minio           | 1.0 | 1 Gi   |
| spark-master    | 1.5 | 1.5 Gi |
| spark-worker    | 2.0 | 2.5 Gi |
| **Total cap**   | 8.5 | ~9 Gi  |

Adjust the `deploy.resources.limits` blocks in `docker-compose.yml` if you need
to fit on a smaller host.
