"""管理 PostgreSQL 引擎与请求级会话，不在启动时自动迁移。"""

from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings


@lru_cache
def session_factory(database_url: str | None = None) -> sessionmaker:
    """建立真实 PostgreSQL 连接池，事务由领域服务显式提交。"""
    engine = create_engine(database_url or get_settings().database_url.get_secret_value(), pool_pre_ping=True, hide_parameters=True)
    return sessionmaker(engine, expire_on_commit=False)
