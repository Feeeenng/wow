"""账号在各团队内的个人显示布局，不属于共享复盘内容。"""

from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKeyConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.utils.time_utils import cst_now


class ReplayPreference(Base):
    """成员移除级联删除偏好，重新加入不会恢复已撤销关系的旧布局。"""

    __tablename__ = "replay_preferences"
    __table_args__ = (
        ForeignKeyConstraint(["team_id", "user_id"], ["team_members.team_id", "team_members.user_id"],
            name="fk_replay_preferences_member_scope", ondelete="CASCADE"),
        CheckConstraint("version >= 0 AND version <= 4294967295", name="version_range"),
    )
    team_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    user_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    version: Mapped[int] = mapped_column(BigInteger, default=0)
    document: Mapped[dict] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=cst_now, onupdate=cst_now)
