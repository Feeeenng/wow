"""PostgreSQL 任务租约、outbox 投递和原子发布门槛。"""

import shutil
import tempfile
import time
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.processing import ProcessingJob, ProcessingOutbox
from app.models.recordings import Recording
from app.models.uploads import Upload
from app.services.processing.media.assets import AssetStager
from app.services.processing.media.pipeline import MediaError, MediaProcessor, published_manifest
from app.services.processing.queue import enqueue_processing
from app.services.uploads.storage import S3Storage
from app.utils.time_utils import cst_now


@dataclass(frozen=True)
class ClaimedJob:
    """离开数据库事务后只持有此次租约和不可变原片身份。"""

    job_id: UUID
    lease: UUID
    recording_id: UUID
    team_id: UUID
    source_key: str
    size: int
    sha256: str
    manifest: dict


class ProcessingService:
    """永久真值在 PG，队列消息重复或丢失均可恢复。"""

    def __init__(self, factory, settings: Settings, storage: S3Storage):
        """会话工厂允许每个短事务及时释放连接，不跨媒体处理持有行锁。"""
        self.factory, self.settings, self.storage = factory, settings, storage

    def dispatch(self, publish) -> int:
        """重排失效租约与未认领消息，发布失败仍保留 outbox。"""
        now, sent = cst_now(), 0
        with self.factory() as session:
            missing = session.scalars(select(Recording).join(Upload, Upload.recording_id == Recording.id)
                .where(Recording.status == "uploaded", Upload.status == "uploaded")
                .where(~select(ProcessingJob.id).where(ProcessingJob.recording_id == Recording.id).exists())
                .with_for_update(skip_locked=True, of=Recording).limit(self.settings.list_page_limit))
            for recording in missing:
                enqueue_processing(session, recording)
            session.commit()
        with self.factory() as session:
            expired = session.execute(select(ProcessingJob, Recording).join(Recording, Recording.id == ProcessingJob.recording_id)
                .where(ProcessingJob.status == "processing", ProcessingJob.lease_expires_at <= now)
                .with_for_update(skip_locked=True, of=[ProcessingJob, Recording]).limit(self.settings.list_page_limit)).all()
            for job, recording in expired:
                terminal = job.attempts >= self.settings.processing_max_attempts
                job.status, recording.status = ("failed", "failed") if terminal else ("retrying", "uploaded")
                job.lease_token, job.lease_expires_at = None, None
                job.next_attempt_at = now
                job.last_error = recording.processing_error = "处理租约已失效，任务重新排队" if not terminal else "处理多次中断，已停止自动重试"
                outbox = session.get(ProcessingOutbox, job.id)
                if outbox:
                    outbox.next_publish_at, outbox.published_at = now, None
            session.commit()
        with self.factory() as session:
            rows = session.execute(select(ProcessingOutbox, ProcessingJob).join(ProcessingJob, ProcessingJob.id == ProcessingOutbox.job_id)
                .where(ProcessingJob.status.in_(["pending", "retrying"]), ProcessingJob.next_attempt_at <= now,
                       ProcessingOutbox.next_publish_at <= now).order_by(ProcessingOutbox.next_publish_at)
                .with_for_update(skip_locked=True, of=ProcessingOutbox).limit(self.settings.list_page_limit)).all()
            for outbox, job in rows:
                outbox.attempts += 1
                try:
                    publish(str(job.id))
                except Exception:
                    # 发布异常可能含 broker 凭证，错误文本不写日志或业务诊断。
                    outbox.next_publish_at = now + timedelta(seconds=self.settings.processing_retry_delay_seconds)
                else:
                    outbox.published_at = now
                    outbox.next_publish_at = now + timedelta(seconds=self.settings.processing_delivery_timeout_seconds)
                    sent += 1
            session.commit()
        return sent

    def claim(self, job_id: UUID) -> ClaimedJob | None:
        """唯一有效租约才能处理原片，重复 Celery 消息直接返回。"""
        now = cst_now()
        with self.factory() as session:
            row = session.execute(select(ProcessingJob, Recording, Upload)
                .join(Recording, Recording.id == ProcessingJob.recording_id).join(Upload, Upload.recording_id == Recording.id)
                .where(ProcessingJob.id == job_id, Upload.status == "uploaded")
                .with_for_update(of=[ProcessingJob, Recording])).first()
            if not row:
                return None
            job, recording, upload = row
            if job.status not in {"pending", "retrying"} or job.next_attempt_at > now:
                return None
            if job.attempts >= self.settings.processing_max_attempts:
                job.status, recording.status = "failed", "failed"
                job.last_error = recording.processing_error = "已超过媒体处理重试次数"
                session.commit()
                return None
            lease = uuid4()
            job.status, recording.status = "processing", "processing"
            job.attempts += 1
            job.lease_token, job.lease_expires_at = lease, now + timedelta(seconds=self.settings.processing_lease_seconds)
            recording.processing_error = None
            session.commit()
            return ClaimedJob(job.id, lease, recording.id, recording.team_id, upload.object_key,
                              recording.file_size_bytes, recording.file_sha256, dict(recording.manifest))

    def run(self, job_id: UUID) -> None:
        """下载整片、验证 SHA、生成并发布 CMAF，任何失败都保留私有原片。"""
        claimed = self.claim(job_id)
        if claimed is None:
            return
        try:
            root = Path(self.settings.processing_temp_directory or Path(tempfile.gettempdir()) / "wow-processing")
            root.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(root).free < claimed.size * 2 + self.settings.processing_disk_reserve_bytes:
                raise MediaError("处理磁盘剩余空间不足，未下载原片")
            deadline = time.monotonic() + self.settings.processing_timeout_seconds
            with tempfile.TemporaryDirectory(prefix=f"job-{claimed.job_id}-", dir=root) as temporary:
                directory = Path(temporary)
                source = directory / "original.mp4"
                assets = AssetStager(self.storage, self.settings, deadline)
                assets.download(claimed.source_key, source, claimed.size, claimed.sha256)
                artifact = MediaProcessor(self.settings, deadline).prepare(source, directory / "hls")
                prefix = f"{self.settings.object_prefix}/{claimed.team_id}/recordings/{claimed.recording_id}/playback/{claimed.lease}"
                assets.publish(prefix, artifact)
                self._finish(claimed, prefix, published_manifest(claimed.manifest, artifact))
        except Exception as error:
            safe = str(error)[:512] if isinstance(error, (MediaError, DomainError)) else "媒体处理发生内部异常，请检查部署环境"
            self._fail(claimed, safe, fatal=isinstance(error, MediaError) and error.fatal)

    def _finish(self, claimed: ClaimedJob, prefix: str, manifest: dict) -> bool:
        """产物写完后再次核对租约，旧 worker 永远不能覆盖新版本。"""
        with self.factory() as session:
            job = session.scalar(select(ProcessingJob).where(ProcessingJob.id == claimed.job_id,
                ProcessingJob.lease_token == claimed.lease, ProcessingJob.status == "processing",
                ProcessingJob.lease_expires_at > cst_now()).with_for_update())
            if not job:
                return False
            recording = session.get(Recording, claimed.recording_id)
            recording.playback_key, recording.playback_version = f"{prefix}/index.m3u8", claimed.lease
            recording.manifest, recording.file_sha256_verified = manifest, True
            recording.status, recording.processing_error = "ready", None
            job.status, job.last_error = "ready", None
            job.lease_token, job.lease_expires_at = None, None
            session.commit()
            return True

    def _fail(self, claimed: ClaimedJob, message: str, fatal: bool):
        """只有当前租约能记录失败，过期 worker 不污染新任务。"""
        with self.factory() as session:
            job = session.scalar(select(ProcessingJob).where(ProcessingJob.id == claimed.job_id,
                ProcessingJob.lease_token == claimed.lease, ProcessingJob.status == "processing",
                ProcessingJob.lease_expires_at > cst_now()).with_for_update())
            if not job:
                return
            terminal = fatal or job.attempts >= self.settings.processing_max_attempts
            job.status = "failed" if terminal else "retrying"
            job.last_error = message
            job.lease_token, job.lease_expires_at = None, None
            job.next_attempt_at = cst_now() + timedelta(seconds=min(
                self.settings.processing_retry_delay_seconds * 2 ** (job.attempts - 1), self.settings.processing_timeout_seconds))
            recording = session.get(Recording, claimed.recording_id)
            recording.status = "failed" if terminal else "uploaded"
            recording.processing_error = message
            outbox = session.get(ProcessingOutbox, job.id)
            if outbox:
                outbox.next_publish_at, outbox.published_at = job.next_attempt_at, None
            session.commit()
