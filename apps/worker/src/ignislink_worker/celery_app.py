import os

from celery import Celery

celery_app = Celery("ignislink_worker")
celery_app.conf.update(
    broker_url=os.getenv("CELERY_BROKER_URL", "memory://"),
    result_backend=os.getenv("CELERY_RESULT_BACKEND", "cache+memory://"),
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
)

celery_app.autodiscover_tasks(
    [
        "ignislink_worker.firms",
        "ignislink_worker.verification",
        "ignislink_worker.outbox",
    ]
)
