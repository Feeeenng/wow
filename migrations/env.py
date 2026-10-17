"""所有部署共用的 PostgreSQL 迁移入口，不在应用启动时隐式执行。"""

from alembic import context
from sqlalchemy import create_engine

from app.core.config import get_settings
from app.db.base import Base
from app.models import annotations, identity, processing, recordings, replay_preferences, uploads, wcl

config = context.config
target_metadata = Base.metadata


def offline():
    """无数据库时生成可审阅 SQL，不声称实际迁移已经成功。"""
    context.configure(url=get_settings().database_url.get_secret_value(), target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def online():
    """只连接显式配置的 PostgreSQL，测试可注入隔离 schema 连接。"""
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = create_engine(get_settings().database_url.get_secret_value(), hide_parameters=True)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    offline()
else:
    online()
