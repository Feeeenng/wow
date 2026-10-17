"""组合云端 API、配置和统一错误响应，不自动创建账号或迁移数据库。"""

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.api import annotations, calibration, identity, media, preferences, recordings, replay, uploads, wcl
from app.core.config import Settings, get_settings
from app.core.errors import DomainError
from app.core.request_body import RequestBodyLimit


def create_app(settings: Settings | None = None) -> FastAPI:
    """测试可显式提供配置，正式进程必须具备完整环境变量。"""
    api = FastAPI(title="魔兽世界团队复盘云端 API", version="0.1.0")
    api.state.settings = settings or get_settings()
    api.add_middleware(RequestBodyLimit, maximum=api.state.settings.max_request_bytes)
    api.add_middleware(CORSMiddleware, allow_origins=api.state.settings.cors_origins,
                       allow_methods=["GET", "POST", "PUT", "OPTIONS"], allow_headers=["Authorization", "Content-Type", "Range"],
                       expose_headers=["Content-Length", "Content-Range", "Accept-Ranges"])

    @api.exception_handler(DomainError)
    async def domain_error(_, error: DomainError):
        """只返回经过领域边界整理的错误，不泄露存储凭证。"""
        headers = {"WWW-Authenticate": "Bearer"} if error.status_code == 401 else None
        return JSONResponse({"detail": error.detail}, status_code=error.status_code, headers=headers)

    @api.exception_handler(SQLAlchemyError)
    async def database_error(_, __):
        """不将 SQL、连接串或数据库驱动内容返回客户端。"""
        return JSONResponse({"detail": "数据库不可用或迁移未完成"}, status_code=503)

    @api.exception_handler(RequestValidationError)
    async def invalid_request(_, error: RequestValidationError):
        """不回显输入值或异常对象，非有限坐标也能稳定返回 422 而非 JSON 编码失败。"""
        errors = [{"loc": item["loc"], "msg": item["msg"], "type": item["type"]} for item in error.errors()]
        return JSONResponse({"detail": errors}, status_code=422)

    @api.get("/health/live")
    def health():
        """仅说明 API 进程存活，不冒充 PG 或 S3 已通过联调。"""
        return {"status": "alive"}

    for router in [identity.router, recordings.router, uploads.router, replay.router, media.router, wcl.router, annotations.router, calibration.router, preferences.router]:
        api.include_router(router, prefix="/api/v1")
    return api


app = create_app()
