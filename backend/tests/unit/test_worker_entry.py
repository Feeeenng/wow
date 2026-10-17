"""验证实际 worker 入口配置，不建立 Redis 或数据库连接。"""

import importlib
import os
import subprocess
import sys
from unittest.mock import patch

from pydantic import SecretStr


def test_celery_entry_uses_json_late_ack_and_bounded_lease(settings):
    """任务只接受 JSON ID，硬超时先于租约，beat 定期恢复 outbox。"""
    configured = settings.model_copy(update={"redis_url": SecretStr("redis://127.0.0.1:1/0")})
    with patch("app.core.config.get_settings", return_value=configured):
        worker = importlib.import_module("app.worker")
    try:
        assert "wow.process_recording" in worker.celery_app.tasks
        assert "wow.dispatch_processing" in worker.celery_app.tasks
        assert "wow.import_wcl" in worker.celery_app.tasks and "wow.dispatch_wcl" in worker.celery_app.tasks
        assert worker.celery_app.conf.task_serializer == "json"
        assert worker.celery_app.conf.task_acks_late is True
        assert worker.celery_app.conf.task_time_limit < configured.processing_lease_seconds
        assert worker.celery_app.conf.beat_schedule["processing-outbox"]["schedule"] == configured.processing_dispatch_interval_seconds
        assert worker.celery_app.conf.beat_schedule["wcl-outbox"]["task"] == "wow.dispatch_wcl"
    finally:
        worker.celery_app.close()


def test_standalone_worker_import_registers_all_foreign_key_targets():
    """新进程不能依赖 API 或先前测试导入过账号模型。"""
    environment = {**os.environ, "WOW_REDIS_URL": "redis://127.0.0.1:1/0"}
    subprocess.run([sys.executable, "-c", "from app.worker import celery_app; from app.db.base import Base; assert len(Base.metadata.tables) == 14; [fk.column for table in Base.metadata.tables.values() for fk in table.foreign_keys]; celery_app.close()"],
                   env=environment, check=True, capture_output=True, timeout=10)


def test_wcl_task_hard_timeout_is_independent_from_short_media_budget():
    """合法短媒体预算不能提前杀掉 WCL，检查实际 Celery task 而非仅配置值。"""
    environment = {**os.environ, "WOW_REDIS_URL": "redis://127.0.0.1:1/0",
        "WOW_PROCESSING_TIMEOUT_SECONDS": "10", "WOW_WCL_IMPORT_TIMEOUT_SECONDS": "600",
        "WOW_WCL_TIMEOUT_SECONDS": "30", "WOW_WCL_LEASE_SECONDS": "1200"}
    script = "\n".join([
        "from app.worker import celery_app, settings",
        "task = celery_app.tasks['wow.import_wcl']",
        "assert celery_app.conf.task_time_limit < settings.wcl_import_timeout_seconds",
        "assert task.time_limit == settings.wcl_import_timeout_seconds + 2 * settings.wcl_timeout_seconds",
        "assert task.time_limit < settings.wcl_lease_seconds",
        "celery_app.close()",
    ])
    subprocess.run([sys.executable, "-c", script], env=environment, check=True, capture_output=True, timeout=10)
