"""团队战斗与成员录像的持久化事实和处理阶段。"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.time_utils import cst_now


class TeamPull(Base):
    """明确选择或报告身份关联的团队战斗，未经 WCL 复核的身份明确标记。"""

    __tablename__ = "team_pulls"
    __table_args__ = (
        UniqueConstraint("team_id", "wcl_report_code", "wcl_fight_id", name="uq_team_pull_report_fight"),
        UniqueConstraint("team_id", "id", name="uq_team_pull_scope"),
        CheckConstraint("ended_at_unix_ms > started_at_unix_ms", name="time_range"),
        CheckConstraint("(wcl_report_code IS NULL) = (wcl_fight_id IS NULL)", name="report_pair"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), index=True)
    encounter_id: Mapped[int] = mapped_column(Integer)
    encounter_name: Mapped[str] = mapped_column(String(256))
    difficulty_id: Mapped[int] = mapped_column(Integer)
    started_at_unix_ms: Mapped[int] = mapped_column(BigInteger)
    ended_at_unix_ms: Mapped[int] = mapped_column(BigInteger)
    wcl_report_code: Mapped[str | None] = mapped_column(String(32))
    wcl_fight_id: Mapped[int | None] = mapped_column(Integer)
    association_status: Mapped[str] = mapped_column(String(32), default="unverified")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)


class Recording(Base):
    """一条平台用户上传的录像，不把角色 GUID 当作授权主体。"""

    __tablename__ = "recordings"
    __table_args__ = (
        UniqueConstraint("team_id", "user_id", "device_id", "local_pull_id", "artifact_version", name="uq_recording_idempotency"),
        UniqueConstraint("team_id", "id", name="uq_recording_scope"),
        UniqueConstraint("team_id", "user_id", "id", name="uq_recording_owner_scope"),
        ForeignKeyConstraint(["team_id", "team_pull_id"], ["team_pulls.team_id", "team_pulls.id"], name="fk_recording_pull_scope"),
        CheckConstraint("file_size_bytes > 0", name="positive_size"),
        CheckConstraint("status IN ('pendingUpload','uploaded','processing','ready','failed')", name="status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), index=True)
    team_pull_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    device_id: Mapped[str] = mapped_column(String(128))
    local_pull_id: Mapped[str] = mapped_column(String(128))
    artifact_version: Mapped[str] = mapped_column(String(128))
    request_digest: Mapped[str] = mapped_column(String(64))
    file_size_bytes: Mapped[int] = mapped_column(BigInteger)
    file_sha256: Mapped[str] = mapped_column(String(64))
    character_guid: Mapped[str] = mapped_column(String(128))
    character_name: Mapped[str] = mapped_column(String(128))
    server_name: Mapped[str | None] = mapped_column(String(128))
    manifest: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(32), default="pendingUpload")
    processing_error: Mapped[str | None] = mapped_column(String(512))
    playback_key: Mapped[str | None] = mapped_column(String(512))
    playback_version: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    file_sha256_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)
