"""每条录像的团队画笔快照及防覆盖版本。"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.time_utils import cst_now


class AnnotationSnapshot(Base):
    """版本和内容原子更新，游戏身份与画笔文本不能决定编辑权限。"""

    __tablename__ = "annotation_snapshots"
    __table_args__ = (
        ForeignKeyConstraint(["team_id", "recording_id"], ["recordings.team_id", "recordings.id"], name="fk_annotation_recording_scope"),
        CheckConstraint("version >= 0 AND version <= 4294967295", name="version_range"),
    )
    recording_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    team_id: Mapped[UUID] = mapped_column(ForeignKey("teams.id"), index=True)
    version: Mapped[int] = mapped_column(BigInteger, default=0)
    items: Mapped[list] = mapped_column(JSONB, default=list)
    updated_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)
