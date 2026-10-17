"""新增个人回放偏好，不回填或改变历史战斗与媒体。"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261017_05"
down_revision = "20261017_04"
branch_labels = None
depends_on = None


def upgrade():
    """仅新增成员关系下的私有布局，版本用于显式 CAS 保存。"""
    op.create_table("replay_preferences",
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("document", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("team_id", "user_id", name="pk_replay_preferences"),
        sa.ForeignKeyConstraint(["team_id", "user_id"], ["team_members.team_id", "team_members.user_id"],
            name="fk_replay_preferences_member_scope", ondelete="CASCADE"),
        sa.CheckConstraint("version >= 0 AND version <= 4294967295", name="ck_replay_preferences_version_range"))


def downgrade():
    """回退仅删除个人偏好，原战斗、视频及团队标注保持不变。"""
    op.drop_table("replay_preferences")
