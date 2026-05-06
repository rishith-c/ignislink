# Multi-stage Dockerfile for the SENTRY backend FastAPI service.
#
# Build context expected at the repository root so we can copy ml/models/*.onnx
# alongside the API source — that way the container ships with the bundled
# fire-spread weights and there is no S3/MinIO bootstrap dance on first boot.

FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

# System deps for asyncpg / numpy wheels (most have prebuilt wheels but we
# still need libgomp1 for onnxruntime).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY apps/api-py/pyproject.toml apps/api-py/README.md ./
COPY apps/api-py/src ./src

RUN pip install --upgrade pip wheel \
    && pip wheel --wheel-dir /wheels -e .

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ONNX_MODEL_PATH=/app/ml/models/fire-spread-prod-candidate-bounded.onnx

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /wheels /wheels
COPY apps/api-py/pyproject.toml apps/api-py/README.md ./
COPY apps/api-py/src ./src
COPY ml/models /app/ml/models

RUN pip install --upgrade pip \
    && pip install --no-index --find-links=/wheels -e . \
    && rm -rf /wheels

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -fsSL http://localhost:8000/health || exit 1

CMD ["uvicorn", "ignislink_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
