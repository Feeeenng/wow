"""离线迁移 SQL 可审阅，但不等于 PostgreSQL 联调。"""

import io
from pathlib import Path

from alembic import command
from alembic.config import Config


def test_frozen_migration_renders_postgresql_schema_without_connection():
    """冻结迁移包含全部表与跨团队约束，不导入未来模型来创建历史版本。"""
    output = io.StringIO()
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"), output_buffer=output)
    command.upgrade(config, "head", sql=True)
    sql = output.getvalue()
    assert sql.count("CREATE TABLE") == 16  # 包含 Alembic 版本表。
    assert "fk_recording_pull_scope" in sql and "fk_upload_recording_owner_scope" in sql
    assert "uq_recording_idempotency" in sql and "JSONB" in sql
    assert "DROP TABLE" not in sql and "INSERT INTO users" not in sql
    assert "processing_outbox" in sql and "playback_version" in sql
    assert "wcl_snapshots" in sql and "fk_wcl_import_snapshot_scope" in sql
    assert "annotation_snapshots" in sql and "fk_annotation_recording_scope" in sql
    assert "replay_preferences" in sql and "fk_replay_preferences_member_scope" in sql and "ON DELETE CASCADE" in sql
