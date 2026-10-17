"""WCL 显式绑定任务、不可变完整快照和稳定有序事件。"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.time_utils import cst_now


class WclSnapshot(Base):
    """快照只在全部分页完成且报告版本不变后发布，绑定和身份不跨版本混用。"""

    __tablename__ = "wcl_snapshots"
    __table_args__ = (
        ForeignKeyConstraint(["team_id", "team_pull_id"], ["team_pulls.team_id", "team_pulls.id"], name="fk_wcl_snapshot_pull_scope"),
        UniqueConstraint("team_id", "team_pull_id", "id", name="uq_wcl_snapshot_scope"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), index=True)
    team_pull_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    report_code: Mapped[str] = mapped_column(String(16))
    report_revision: Mapped[int] = mapped_column(Integer)
    report_started_at_unix_ms: Mapped[int] = mapped_column(BigInteger)
    fight_id: Mapped[int] = mapped_column(Integer)
    metadata_json: Mapped[dict] = mapped_column(JSONB)
    event_count: Mapped[int] = mapped_column(Integer)
    raw_event_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)


class WclImport(Base):
    """任务本身保存 outbox 投递事实；每个团队 Pull 最多一个可恢复导入。"""

    __tablename__ = "wcl_imports"
    __table_args__ = (
        ForeignKeyConstraint(["team_id", "team_pull_id"], ["team_pulls.team_id", "team_pulls.id"], name="fk_wcl_import_pull_scope"),
        ForeignKeyConstraint(["team_id", "team_pull_id", "snapshot_id"],
            ["wcl_snapshots.team_id", "wcl_snapshots.team_pull_id", "wcl_snapshots.id"], name="fk_wcl_import_snapshot_scope"),
        UniqueConstraint("team_pull_id", name="uq_wcl_import_pull"),
        CheckConstraint("status IN ('pending','importing','ready','failed')", name="status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    team_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("teams.id"), index=True)
    team_pull_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    requested_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    request_json: Mapped[dict] = mapped_column(JSONB)
    request_digest: Mapped[str] = mapped_column(String(64))
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_token: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_publish_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, index=True)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)


class WclEvent(Base):
    """事件时间保存报告绝对毫秒，查询时减共同 Pull 起点，不修改视频基准。"""

    __tablename__ = "wcl_events"
    snapshot_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("wcl_snapshots.id", ondelete="CASCADE"), primary_key=True)
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    absolute_time_ms: Mapped[int] = mapped_column(BigInteger)
    payload: Mapped[dict] = mapped_column(JSONB)
