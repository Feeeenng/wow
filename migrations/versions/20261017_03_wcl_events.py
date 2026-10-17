"""新增 WCL 公共报告任务、原子快照和稳定分页事件。"""

from alembic import op
import sqlalchemy as sa

revision = "20261017_03"
down_revision = "20261017_02"
branch_labels = None
depends_on = None


def upgrade():
    """只新增独立事件域，旧录像不伪造完整事件版本。"""
    op.execute(sa.text("""
        CREATE TABLE wcl_snapshots (
            id UUID NOT NULL,
            team_id UUID NOT NULL,
            team_pull_id UUID NOT NULL,
            report_code VARCHAR(16) NOT NULL,
            report_revision INTEGER NOT NULL,
            report_started_at_unix_ms BIGINT NOT NULL,
            fight_id INTEGER NOT NULL,
            metadata_json JSONB NOT NULL,
            event_count INTEGER NOT NULL,
            raw_event_count INTEGER NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT pk_wcl_snapshots PRIMARY KEY (id),
            CONSTRAINT fk_wcl_snapshot_pull_scope FOREIGN KEY(team_id, team_pull_id) REFERENCES team_pulls (team_id, id),
            CONSTRAINT uq_wcl_snapshot_scope UNIQUE (team_id, team_pull_id, id),
            CONSTRAINT fk_wcl_snapshots_team_id_teams FOREIGN KEY(team_id) REFERENCES teams (id)
        )
    """))
    op.execute(sa.text('CREATE INDEX ix_wcl_snapshots_team_id ON wcl_snapshots (team_id)'))
    op.execute(sa.text('CREATE INDEX ix_wcl_snapshots_team_pull_id ON wcl_snapshots (team_pull_id)'))
    op.execute(sa.text("""
        CREATE TABLE wcl_imports (
            id UUID NOT NULL,
            team_id UUID NOT NULL,
            team_pull_id UUID NOT NULL,
            requested_by UUID NOT NULL,
            request_json JSONB NOT NULL,
            request_digest VARCHAR(64) NOT NULL,
            snapshot_id UUID,
            status VARCHAR(16) NOT NULL,
            attempts INTEGER NOT NULL,
            lease_token UUID,
            lease_expires_at TIMESTAMP WITH TIME ZONE,
            next_publish_at TIMESTAMP WITH TIME ZONE NOT NULL,
            next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
            published_at TIMESTAMP WITH TIME ZONE,
            last_error VARCHAR(512),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT pk_wcl_imports PRIMARY KEY (id),
            CONSTRAINT fk_wcl_import_pull_scope FOREIGN KEY(team_id, team_pull_id) REFERENCES team_pulls (team_id, id),
            CONSTRAINT fk_wcl_import_snapshot_scope FOREIGN KEY(team_id, team_pull_id, snapshot_id) REFERENCES wcl_snapshots (team_id, team_pull_id, id),
            CONSTRAINT uq_wcl_import_pull UNIQUE (team_pull_id),
            CONSTRAINT ck_wcl_imports_status CHECK (status IN ('pending','importing','ready','failed')),
            CONSTRAINT fk_wcl_imports_team_id_teams FOREIGN KEY(team_id) REFERENCES teams (id),
            CONSTRAINT fk_wcl_imports_requested_by_users FOREIGN KEY(requested_by) REFERENCES users (id)
        )
    """))
    op.execute(sa.text('CREATE INDEX ix_wcl_imports_next_publish_at ON wcl_imports (next_publish_at)'))
    op.execute(sa.text('CREATE INDEX ix_wcl_imports_status ON wcl_imports (status)'))
    op.execute(sa.text('CREATE INDEX ix_wcl_imports_team_id ON wcl_imports (team_id)'))
    op.execute(sa.text("""
        CREATE TABLE wcl_events (
            snapshot_id UUID NOT NULL,
            ordinal INTEGER NOT NULL,
            absolute_time_ms BIGINT NOT NULL,
            payload JSONB NOT NULL,
            CONSTRAINT pk_wcl_events PRIMARY KEY (snapshot_id, ordinal),
            CONSTRAINT fk_wcl_events_snapshot_id_wcl_snapshots FOREIGN KEY(snapshot_id) REFERENCES wcl_snapshots (id) ON DELETE CASCADE
        )
    """))


def downgrade():
    """回退仅移除 WCL 事件索引，不操作用户原视频。"""
    op.drop_table('wcl_events')
    op.drop_table('wcl_imports')
    op.drop_table('wcl_snapshots')
