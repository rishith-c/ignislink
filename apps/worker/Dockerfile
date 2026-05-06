# SENTRY data pipeline worker.
#
# Build context is the repo root so we can copy apps/worker/* into /app/apps/worker
# and run the package via ``python -m apps.worker --sources ... --sinks ...``.
#
# Build:
#   docker build -f apps/worker/Dockerfile -t sentry-worker:dev .
#
# Run (sources only):
#   docker run --network sentry-net -e KAFKA_BOOTSTRAP_SERVERS=kafka:9092 \
#     sentry-worker:dev --sources firms,quakes,water
#
# Run (Postgres sinks only):
#   docker run --network sentry-net \
#     -e KAFKA_BOOTSTRAP_SERVERS=kafka:9092 \
#     -e PG_DSN=postgresql://sentry:sentry@postgres:5432/sentry \
#     sentry-worker:dev --sinks postgres
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app:/app/apps/worker/src

WORKDIR /app

# Build deps for psycopg / kafka-python wheels are already prebuilt; we just
# need a tiny build chain in case any pure-Python package needs it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY apps/worker/pyproject.toml apps/worker/README.md ./apps/worker/
COPY apps/worker/src ./apps/worker/src
COPY apps/worker/__init__.py apps/worker/__main__.py ./apps/worker/
COPY apps/worker/fixtures ./apps/worker/fixtures
COPY apps/__init__.py ./apps/__init__.py

RUN pip install --upgrade pip \
    && pip install -e ./apps/worker

# Default to running everything end-to-end; override with `--sources` / `--sinks`.
ENTRYPOINT ["python", "-m", "apps.worker"]
CMD ["--sources", "firms,quakes,water", "--sinks", "postgres"]
