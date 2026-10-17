"""媒体任务与可重复发布的 PG outbox，不把 Redis 当成永久状态。"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.time_utils import cst_now


class ProcessingJob(Base):
    """任务租约约束实际处理者，旧 worker 不能覆盖新产物。"""

    __tablename__ = "processing_jobs"
    __table_args__ = (
        ForeignKeyConstraint(["team_id", "recording_id"], ["recordings.team_id", "recordings.id"], name="fk_processing_recording_scope"),
        CheckConstraint("status IN ('pending','processing','retrying','ready','failed')", name="status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), index=True)
    recording_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    last_error: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)


class ProcessingOutbox(Base):
    """发布成功前后都可重排，消息丢失不丢 PG 任务事实。"""

    __tablename__ = "processing_outbox"
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("processing_jobs.id", ondelete="CASCADE"), primary_key=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_publish_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
