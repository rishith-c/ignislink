FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY apps/worker/pyproject.toml apps/worker/README.md ./
COPY apps/worker/src ./src

RUN pip install --no-cache-dir -e .

CMD ["celery", "-A", "ignislink_worker.celery_app:celery_app", "worker", "--loglevel=INFO"]
