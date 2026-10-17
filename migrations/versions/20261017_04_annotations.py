"""新增团队录像画笔快照，历史录像读取时仍为版本零。"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261017_04"
down_revision = "20261017_03"
branch_labels = None
depends_on = None


def upgrade():
    """只新增快照表，不替旧录像伪造画笔或改变媒体时间基准。"""
    op.create_table("annotation_snapshots",
        sa.Column("recording_id", sa.Uuid(), nullable=False),
        sa.Column("team_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.Column("items", postgresql.JSONB(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("recording_id", name="pk_annotation_snapshots"),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], name="fk_annotation_snapshots_team_id_teams"),
        sa.ForeignKeyConstraint(["team_id", "recording_id"], ["recordings.team_id", "recordings.id"], name="fk_annotation_recording_scope"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], name="fk_annotation_snapshots_updated_by_users"),
        sa.CheckConstraint("version >= 0 AND version <= 4294967295", name="ck_annotation_snapshots_version_range"))
    op.create_index("ix_annotation_snapshots_team_id", "annotation_snapshots", ["team_id"])


def downgrade():
    """只删除团队画笔快照，不修改原录像或其他回放事实。"""
    op.drop_index("ix_annotation_snapshots_team_id", table_name="annotation_snapshots")
    op.drop_table("annotation_snapshots")
