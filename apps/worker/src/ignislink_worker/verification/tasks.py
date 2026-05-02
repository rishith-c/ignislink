from ignislink_worker.celery_app import celery_app


@celery_app.task(name="ignislink.verification.batch_verify")
def batch_verify() -> dict[str, str]:
    return {"status": "stub", "stage": "stage-1-tests-required"}
