from sentry-max_worker.celery_app import celery_app


@celery_app.task(name="sentry-max.outbox.flush")
def flush_outbox() -> dict[str, str]:
    return {"status": "stub", "stage": "stage-0"}
