"""请求级身份、配置、会话及领域服务注入。"""

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainError
from app.db.session import session_factory
from app.services.identity.access import AccessService, Principal
from app.services.recordings.registration import RegistrationService
from app.services.replay.query import ReplayService
from app.services.replay.media import ReplayMediaService
from app.services.processing.retry import ProcessingRetryService
from app.services.uploads.service import UploadService
from app.services.uploads.storage import S3Storage

bearer = HTTPBearer(auto_error=False)


def get_session(request: Request):
    """按当前应用配置建立会话，工厂测试不能意外连接正式数据库。"""
    with session_factory(request.app.state.settings.database_url.get_secret_value())() as session:
        yield session


def get_api_settings(request: Request) -> Settings:
    """应用工厂可以注入测试配置，正常运行统一读取环境。"""
    return request.app.state.settings


def get_principal(credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
                  session: Session = Depends(get_session), settings: Settings = Depends(get_api_settings)) -> Principal:
    """请求自报的 userId、团队角色和角色 GUID 都不能替代 Bearer 认证。"""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise DomainError(401, "请提供有效访问令牌")
    return AccessService(session).authenticate(credentials.credentials, settings)


def get_access(session: Session = Depends(get_session), principal: Principal = Depends(get_principal)) -> AccessService:
    """为只读账号信息注入已认证范围。"""
    return AccessService(session, principal)


def get_optional_principal(credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
                           session: Session = Depends(get_session), settings: Settings = Depends(get_api_settings)) -> Principal | None:
    """媒体允许短期 grant；若显式提供 Bearer 则必须有效，不能静默忽略坏令牌。"""
    if credentials is None:
        return None
    return AccessService(session).authenticate(credentials.credentials, settings)


def get_registration(session: Session = Depends(get_session), principal: Principal = Depends(get_principal),
                     settings: Settings = Depends(get_api_settings)) -> RegistrationService:
    """登记只依赖 PostgreSQL，不提前连接 S3。"""
    return RegistrationService(session, principal, settings)


def get_storage(settings: Settings = Depends(get_api_settings)) -> S3Storage:
    """SDK 不执行隐式环境凭证发现或默认存储初始化。"""
    storage = S3Storage(settings)
    try:
        yield storage
    finally:
        storage.close()


def get_uploads(session: Session = Depends(get_session), principal: Principal = Depends(get_principal),
                settings: Settings = Depends(get_api_settings), storage: S3Storage = Depends(get_storage)) -> UploadService:
    """同一请求的身份、会话与存储由 FastAPI 依赖缓存复用。"""
    return UploadService(session, principal, settings, storage)


def get_replay(session: Session = Depends(get_session), principal: Principal = Depends(get_principal),
               settings: Settings = Depends(get_api_settings)) -> ReplayService:
    """团队只读查询不创建上传进程或媒体任务。"""
    return ReplayService(session, principal, settings)


def get_replay_media(session: Session = Depends(get_session), principal: Principal | None = Depends(get_optional_principal),
                     settings: Settings = Depends(get_api_settings), storage: S3Storage = Depends(get_storage)) -> ReplayMediaService:
    """媒体访问在每片请求中重新检查账号与团队关系。"""
    return ReplayMediaService(session, settings, storage, principal)


def get_processing_retry(session: Session = Depends(get_session), principal: Principal = Depends(get_principal)) -> ProcessingRetryService:
    """显式重试仍经过平台身份和团队权限。"""
    return ProcessingRetryService(session, principal)
