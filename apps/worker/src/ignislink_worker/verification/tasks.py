from sentry-max_worker.celery_app import celery_app


@celery_app.task(name="sentry-max.verification.batch_verify")
def batch_verify() -> dict[str, str]:
    return {"status": "stub", "stage": "stage-1-tests-required"}
