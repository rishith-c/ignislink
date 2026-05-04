from ignislink_worker.celery_app import celery_app
from ignislink_worker.firms.tasks import poll_bboxes
from ignislink_worker.outbox.tasks import flush_outbox
from ignislink_worker.verification.tasks import batch_verify


def test_celery_app_registers_stage_zero_tasks() -> None:
    assert celery_app.main == "ignislink_worker"
    assert poll_bboxes.name == "ignislink.firms.poll_bboxes"
    assert batch_verify.name == "ignislink.verification.batch_verify"
    assert flush_outbox.name == "ignislink.outbox.flush"
