"""创建账号、团队、录像和受校验分片上传表；无旧数据回填。"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261017_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    """只创建本轮新增表及约束，不修改既有项目数据。"""
    op.create_table('teams',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('name', sa.String(length=128), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_teams'))
    )
    op.create_table('users',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('display_name', sa.String(length=128), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users')),
    sa.UniqueConstraint('display_name', name=op.f('uq_users_display_name'))
    )
    op.create_table('api_tokens',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('token_digest', sa.String(length=64), nullable=False),
    sa.Column('label', sa.String(length=128), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_api_tokens_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_api_tokens')),
    sa.UniqueConstraint('token_digest', name=op.f('uq_api_tokens_token_digest'))
    )
    op.create_index(op.f('ix_api_tokens_user_id'), 'api_tokens', ['user_id'], unique=False)
    op.create_table('team_members',
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("role IN ('leader','analyst','member')", name=op.f('ck_team_members_role')),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_team_members_team_id_teams'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_team_members_user_id_users'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('team_id', 'user_id', name=op.f('pk_team_members'))
    )
    op.create_table('team_pulls',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('encounter_id', sa.Integer(), nullable=False),
    sa.Column('encounter_name', sa.String(length=256), nullable=False),
    sa.Column('difficulty_id', sa.Integer(), nullable=False),
    sa.Column('started_at_unix_ms', sa.BigInteger(), nullable=False),
    sa.Column('ended_at_unix_ms', sa.BigInteger(), nullable=False),
    sa.Column('wcl_report_code', sa.String(length=32), nullable=True),
    sa.Column('wcl_fight_id', sa.Integer(), nullable=True),
    sa.Column('association_status', sa.String(length=32), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('(wcl_report_code IS NULL) = (wcl_fight_id IS NULL)', name=op.f('ck_team_pulls_report_pair')),
    sa.CheckConstraint('ended_at_unix_ms > started_at_unix_ms', name=op.f('ck_team_pulls_time_range')),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_team_pulls_team_id_teams')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_team_pulls')),
    sa.UniqueConstraint('team_id', 'id', name='uq_team_pull_scope'),
    sa.UniqueConstraint('team_id', 'wcl_report_code', 'wcl_fight_id', name='uq_team_pull_report_fight')
    )
    op.create_index(op.f('ix_team_pulls_team_id'), 'team_pulls', ['team_id'], unique=False)
    op.create_table('recordings',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('team_pull_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('device_id', sa.String(length=128), nullable=False),
    sa.Column('local_pull_id', sa.String(length=128), nullable=False),
    sa.Column('artifact_version', sa.String(length=128), nullable=False),
    sa.Column('request_digest', sa.String(length=64), nullable=False),
    sa.Column('file_size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('file_sha256', sa.String(length=64), nullable=False),
    sa.Column('character_guid', sa.String(length=128), nullable=False),
    sa.Column('character_name', sa.String(length=128), nullable=False),
    sa.Column('server_name', sa.String(length=128), nullable=True),
    sa.Column('manifest', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=32), nullable=False),
    sa.Column('processing_error', sa.String(length=512), nullable=True),
    sa.Column('playback_key', sa.String(length=512), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('pendingUpload','uploaded','processing','ready','failed')", name=op.f('ck_recordings_status')),
    sa.CheckConstraint('file_size_bytes > 0', name=op.f('ck_recordings_positive_size')),
    sa.ForeignKeyConstraint(['team_id', 'team_pull_id'], ['team_pulls.team_id', 'team_pulls.id'], name='fk_recording_pull_scope'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_recordings_team_id_teams')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_recordings_user_id_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_recordings')),
    sa.UniqueConstraint('team_id', 'id', name='uq_recording_scope'),
    sa.UniqueConstraint('team_id', 'user_id', 'device_id', 'local_pull_id', 'artifact_version', name='uq_recording_idempotency'),
    sa.UniqueConstraint('team_id', 'user_id', 'id', name='uq_recording_owner_scope')
    )
    op.create_index(op.f('ix_recordings_team_id'), 'recordings', ['team_id'], unique=False)
    op.create_index(op.f('ix_recordings_team_pull_id'), 'recordings', ['team_pull_id'], unique=False)
    op.create_index(op.f('ix_recordings_user_id'), 'recordings', ['user_id'], unique=False)
    op.create_table('uploads',
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('team_id', sa.Uuid(), nullable=False),
    sa.Column('user_id', sa.Uuid(), nullable=False),
    sa.Column('recording_id', sa.Uuid(), nullable=False),
    sa.Column('object_key', sa.String(length=512), nullable=False),
    sa.Column('storage_upload_id', sa.String(length=1024), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('part_size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('total_parts', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("status IN ('pending','uploading','uploaded','aborted')", name=op.f('ck_uploads_status')),
    sa.CheckConstraint('part_size_bytes >= 5242880 AND total_parts BETWEEN 1 AND 10000', name=op.f('ck_uploads_part_layout')),
    sa.ForeignKeyConstraint(['team_id', 'user_id', 'recording_id'], ['recordings.team_id', 'recordings.user_id', 'recordings.id'], name='fk_upload_recording_owner_scope'),
    sa.ForeignKeyConstraint(['team_id'], ['teams.id'], name=op.f('fk_uploads_team_id_teams')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_uploads_user_id_users')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_uploads')),
    sa.UniqueConstraint('object_key', name=op.f('uq_uploads_object_key')),
    sa.UniqueConstraint('recording_id', name=op.f('uq_uploads_recording_id'))
    )
    op.create_index(op.f('ix_uploads_team_id'), 'uploads', ['team_id'], unique=False)
    op.create_index(op.f('ix_uploads_user_id'), 'uploads', ['user_id'], unique=False)
    op.create_table('upload_parts',
    sa.Column('upload_id', sa.Uuid(), nullable=False),
    sa.Column('part_number', sa.Integer(), nullable=False),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('checksum_sha256', sa.String(length=64), nullable=False),
    sa.Column('etag', sa.String(length=256), nullable=True),
    sa.Column('confirmed_at', sa.DateTime(timezone=True), nullable=True),
    sa.CheckConstraint('part_number BETWEEN 1 AND 10000 AND size_bytes > 0', name=op.f('ck_upload_parts_layout')),
    sa.ForeignKeyConstraint(['upload_id'], ['uploads.id'], name=op.f('fk_upload_parts_upload_id_uploads'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('upload_id', 'part_number', name=op.f('pk_upload_parts'))
    )


def downgrade():
    """显式回退会删除云端新表及其数据，禁止在应用启动时调用。"""
    op.drop_table('upload_parts')
    op.drop_table('uploads')
    op.drop_table('recordings')
    op.drop_table('team_pulls')
    op.drop_table('team_members')
    op.drop_table('api_tokens')
    op.drop_table('users')
    op.drop_table('teams')
