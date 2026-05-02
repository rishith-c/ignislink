from ignislink_worker.celery_app import celery_app


@celery_app.task(name="ignislink.firms.poll_bboxes")
def poll_bboxes() -> dict[str, str]:
    return {"status": "stub", "stage": "stage-1-tests-required"}
