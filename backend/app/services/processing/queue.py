"""将媒体处理任务和上传完成放在同一数据库事务内。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.processing import ProcessingJob, ProcessingOutbox
from app.models.recordings import Recording


def enqueue_processing(session: Session, recording: Recording) -> None:
    """只登记一次；提交前不向 broker 发布，避免事务回滚后出现幽灵任务。"""
    existing = session.scalar(select(ProcessingJob).where(ProcessingJob.team_id == recording.team_id,
                                                         ProcessingJob.recording_id == recording.id))
    if existing:
        return
    job = ProcessingJob(team_id=recording.team_id, recording_id=recording.id, status="pending", attempts=0)
    session.add(job)
    session.flush()
    session.add(ProcessingOutbox(job_id=job.id, attempts=0))
