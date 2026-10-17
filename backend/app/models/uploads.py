"""S3 Multipart 会话与已验证的分片真值。"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.time_utils import cst_now


class Upload(Base):
    """恢复任务持久化到 PostgreSQL，S3 uploadId 不暴露为平台身份。"""

    __tablename__ = "uploads"
    __table_args__ = (
        CheckConstraint("status IN ('pending','uploading','uploaded','aborted')", name="status"),
        CheckConstraint("part_size_bytes >= 5242880 AND total_parts BETWEEN 1 AND 10000", name="part_layout"),
        ForeignKeyConstraint(["team_id", "user_id", "recording_id"], ["recordings.team_id", "recordings.user_id", "recordings.id"], name="fk_upload_recording_owner_scope"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    recording_id: Mapped[uuid.UUID] = mapped_column(Uuid, unique=True)
    object_key: Mapped[str] = mapped_column(String(512), unique=True)
    storage_upload_id: Mapped[str | None] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    part_size_bytes: Mapped[int] = mapped_column(BigInteger)
    total_parts: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)


class UploadPart(Base):
    """签发前锁定分片 SHA，确认后只采信 S3 实际返回的大小及校验和。"""

    __tablename__ = "upload_parts"
    __table_args__ = (CheckConstraint("part_number BETWEEN 1 AND 10000 AND size_bytes > 0", name="layout"),)
    upload_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("uploads.id", ondelete="CASCADE"), primary_key=True)
    part_number: Mapped[int] = mapped_column(Integer, primary_key=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum_sha256: Mapped[str] = mapped_column(String(64))
    etag: Mapped[str | None] = mapped_column(String(256))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
