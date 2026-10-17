"""新增可恢复媒体任务与 outbox，旧原片摘要默认保持未验证。"""

from alembic import op
import sqlalchemy as sa

revision = "20261017_02"
down_revision = "20261017_01"
branch_labels = None
depends_on = None


def upgrade():
    """旧已上传录像由调度器按真实上传状态补充任务，不伪造已完成媒体。"""
    op.add_column("recordings", sa.Column("playback_version", sa.Uuid(), nullable=True))
    op.add_column("recordings", sa.Column("file_sha256_verified", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table('processing_jobs',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('recording_id', sa.Uuid(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('lease_token', sa.Uuid(), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_error', sa.String(length=512), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('pending','processing','retrying','ready','failed')", name=op.f('ck_processing_jobs_status')),
    sa.ForeignKeyConstraint(['team_id', 'recording_id'], ['recordings.team_id', 'recordings.id'], name='fk_processing_recording_scope'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_processing_jobs_team_id_teams')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_processing_jobs')),
    sa.UniqueConstraint('recording_id', name=op.f('uq_processing_jobs_recording_id'))
    )
    op.create_index(op.f('ix_processing_jobs_status'), 'processing_jobs', ['status'], unique=False)
    op.create_index(op.f('ix_processing_jobs_team_id'), 'processing_jobs', ['team_id'], unique=False)
    op.create_table('processing_outbox',
    sa.Column('job_id', sa.Uuid(), nullable=False),
    sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('next_publish_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['job_id'], ['processing_jobs.id'], name=op.f('fk_processing_outbox_job_id_processing_jobs'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('job_id', name=op.f('pk_processing_outbox'))
    )
    op.create_index(op.f('ix_processing_outbox_next_publish_at'), 'processing_outbox', ['next_publish_at'], unique=False)


def downgrade():
    """显式回退删除处理任务及新验证字段，不删除私有原片对象。"""
    op.drop_table("processing_outbox")
    op.drop_table("processing_jobs")
    op.drop_column("recordings", "file_sha256_verified")
    op.drop_column("recordings", "playback_version")
