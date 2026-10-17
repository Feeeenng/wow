"""当前上传者或团长显式重试媒体处理。"""

from uuid import UUID

from sqlalchemy import select

from app.core.errors import DomainError
from app.models.processing import ProcessingJob, ProcessingOutbox
from app.models.recordings import Recording
from app.models.uploads import Upload
from app.services.identity.access import AccessService
from app.utils.time_utils import cst_now


class ProcessingRetryService:
    """只重试已经完整上传的原片，不修改原始内容、平台归属或产物身份。"""

    def __init__(self, session, principal):
        """保存当前平台用户，不按录像角色推断管理员。"""
        self.session, self.principal = session, principal
        self.access = AccessService(session, principal)

    def retry(self, team_id: UUID, recording_id: UUID) -> dict:
        """租约仍有效的任务不能被用户重复启动，已 ready 也不隐式覆盖。"""
        member = self.access.require_team(team_id)
        query = select(Recording).where(Recording.team_id.in_(self.access.team_ids()))
        recording = self.session.scalar(query.where(Recording.team_id == team_id, Recording.id == recording_id))
        if not recording:
            raise DomainError(404, "录像不存在")
        if recording.user_id != self.principal.user_id and member.role != "leader":
            raise DomainError(403, "仅上传者或本团队团长可以重试处理")
        job = self.session.scalar(select(ProcessingJob).where(ProcessingJob.team_id == team_id,
            ProcessingJob.recording_id == recording_id).with_for_update())
        recording = self.session.scalar(query.where(Recording.id == recording_id).with_for_update().execution_options(populate_existing=True))
        if not job:
            raise DomainError(409, "录像尚未建立媒体任务，请等待上传完成及任务调度")
        if recording.status == "ready" or job.status == "processing" and job.lease_expires_at and job.lease_expires_at > cst_now():
            raise DomainError(409, "录像已经就绪或仍在有效处理租约中")
        if recording.status == "uploaded" and job.status in {"pending", "retrying"}:
            return {"recordingId": recording.id, "status": recording.status, "processingStatus": job.status}
        upload = self.session.scalar(select(Upload).where(Upload.team_id == team_id, Upload.recording_id == recording_id))
        if not upload or upload.status != "uploaded":
            raise DomainError(409, "原片尚未完整上传")
        now = cst_now()
        job.status, job.attempts, job.last_error = "retrying", 0, None
        job.lease_token, job.lease_expires_at, job.next_attempt_at = None, None, now
        recording.status, recording.processing_error = "uploaded", None
        recording.playback_key, recording.playback_version = None, None
        outbox = self.session.get(ProcessingOutbox, job.id)
        if outbox:
            outbox.published_at, outbox.next_publish_at = None, now
        else:
            self.session.add(ProcessingOutbox(job_id=job.id, attempts=0, next_publish_at=now))
        self.session.commit()
        return {"recordingId": recording.id, "status": recording.status, "processingStatus": job.status}
