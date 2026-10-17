"""数据库任务、broker 故障和旧租约发布隔离的领域测试。"""

from unittest.mock import MagicMock
from uuid import uuid4

from app.models.processing import ProcessingJob, ProcessingOutbox
from app.models.recordings import Recording
from app.services.processing.jobs import ClaimedJob, ProcessingService
from app.services.processing.queue import enqueue_processing
from app.utils.time_utils import cst_now


def test_enqueue_stays_in_upload_transaction_and_does_not_publish():
    """调用者成功提交前任务与 outbox 均不可在 broker 出现。"""
    session = MagicMock()
    session.scalar.return_value = None
    recording = Recording(id=uuid4(), team_id=uuid4(), status="uploaded")
    added = []
    session.add.side_effect = added.append
    session.flush.side_effect = lambda: setattr(added[0], "id", uuid4())
    enqueue_processing(session, recording)
    assert isinstance(added[0], ProcessingJob) and isinstance(added[1], ProcessingOutbox)
    assert added[1].job_id == added[0].id
    session.commit.assert_not_called()


def test_broker_failure_retains_outbox_and_later_dispatches_same_job(settings):
    """存储永久状态不依赖 Redis，失败不保存含连接凭证的异常文本。"""
    factory, session, storage = MagicMock(), MagicMock(), MagicMock()
    factory.return_value.__enter__.return_value = session
    session.scalars.return_value = []
    job = ProcessingJob(id=uuid4(), status="pending")
    outbox = ProcessingOutbox(job_id=job.id, attempts=0, next_publish_at=cst_now())
    service = ProcessingService(factory, settings, storage)
    session.execute.return_value.all.side_effect = [[], [(outbox, job)]]
    publisher = MagicMock(side_effect=RuntimeError("broker credential must never be copied"))
    assert service.dispatch(publisher) == 0
    assert outbox.published_at is None and outbox.next_publish_at > cst_now()
    session.execute.return_value.all.side_effect = [[], [(outbox, job)]]
    publisher.side_effect = None
    assert service.dispatch(publisher) == 1
    assert outbox.published_at is not None and outbox.attempts == 2
    assert publisher.call_args.args == (str(job.id),)


def test_stale_worker_cannot_publish_or_change_new_task_state(settings):
    """完成和失败都必须再次匹配租约与有效期，旧版本不能覆盖。"""
    factory, session = MagicMock(), MagicMock()
    factory.return_value.__enter__.return_value = session
    session.scalar.return_value = None
    service = ProcessingService(factory, settings, MagicMock())
    claimed = ClaimedJob(uuid4(), uuid4(), uuid4(), uuid4(), "private-source", 1, "a" * 64, {})
    assert service._finish(claimed, "old-version", {}) is False
    statement = str(session.scalar.call_args.args[0])
    assert "lease_token" in statement and "lease_expires_at >" in statement
    service._fail(claimed, "old failure", fatal=True)
    session.get.assert_not_called()
    session.commit.assert_not_called()


def test_successful_publication_sets_version_and_full_sha_only_after_artifacts(settings):
    """ready 与整文件验证事实在同一最终事务发布。"""
    factory, session = MagicMock(), MagicMock()
    factory.return_value.__enter__.return_value = session
    claimed = ClaimedJob(uuid4(), uuid4(), uuid4(), uuid4(), "source", 1, "a" * 64, {})
    job = ProcessingJob(id=claimed.job_id, lease_token=claimed.lease, status="processing")
    recording = Recording(id=claimed.recording_id, status="processing")
    session.scalar.return_value, session.get.return_value = job, recording
    service = ProcessingService(factory, settings, MagicMock())
    assert service._finish(claimed, "server-version", {"videoZeroMs": 100})
    assert recording.status == "ready" and job.status == "ready"
    assert recording.playback_version == claimed.lease and recording.file_sha256_verified is True
    assert recording.playback_key == "server-version/index.m3u8"
    session.commit.assert_called_once()
