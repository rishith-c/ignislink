from sentry-max_worker.celery_app import celery_app
from sentry-max_worker.firms.tasks import poll_bboxes
from sentry-max_worker.outbox.tasks import flush_outbox
from sentry-max_worker.verification.tasks import batch_verify


def test_celery_app_registers_stage_zero_tasks() -> None:
    assert celery_app.main == "sentry-max_worker"
    assert poll_bboxes.name == "sentry-max.firms.poll_bboxes"
    assert batch_verify.name == "sentry-max.verification.batch_verify"
    assert flush_outbox.name == "sentry-max.outbox.flush"
