# IgnisLink Local Infra

Stage 0 local stack:

- PostgreSQL 16 with TimescaleDB and PostGIS extensions
- Redis for cache, pub/sub, Celery broker, and BullMQ
- FastAPI internal service
- Hono public alerts service
- Celery worker and beat
- Prometheus scrape target for the Node API

```bash
docker compose -f infra/docker-compose.yml up --build
```

The stack is a boot scaffold only. Stage 1 adds real FIRMS cron polling, PostGIS
tables, deduplication, retry policies, and provider circuit breakers.
