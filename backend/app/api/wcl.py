"""公共 WCL 导入状态、显式绑定及团队录像事件分页入口。"""

from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import get_api_settings, get_principal, get_session
from app.schemas.wcl import ImportWcl
from app.services.wcl.importing.requests import WclImportService
from app.services.wcl.query import WclQueryService
from app.services.wcl.review.query import DeathReviewService

router = APIRouter(prefix="/teams/{team_id}", tags=["WCL 公共报告"])


def get_wcl(session=Depends(get_session), principal=Depends(get_principal), settings=Depends(get_api_settings)):
    """复用请求级平台身份和数据库会话，不向客户端转发 WCL 凭证。"""
    return WclImportService(session, principal, settings)


def get_death_review(session=Depends(get_session), principal=Depends(get_principal), settings=Depends(get_api_settings)):
    """团队死亡明细不需要S3连接，也不接收客户端自报身份。"""
    return DeathReviewService(session, principal, settings)


@router.get("/pulls/{pull_id}/wcl")
def status(team_id: UUID, pull_id: UUID, service: WclQueryService = Depends(get_wcl)):
    """团队成员可查看旧发布版本和当前任务，disabled 不冒充可用。"""
    return service.status(team_id, pull_id)


@router.post("/pulls/{pull_id}/wcl/imports", status_code=202)
def submit(team_id: UUID, pull_id: UUID, request: ImportWcl, service: WclImportService = Depends(get_wcl)):
    """导入权限和跨资源绑定检查在领域服务中执行。"""
    return service.submit(team_id, pull_id, request)


@router.get("/recordings/{recording_id}/events")
def events(team_id: UUID, recording_id: UUID, cursor: str | None = Query(default=None, max_length=2048),
           limit: int | None = Query(default=None, ge=1), service: WclQueryService = Depends(get_wcl)):
    """只返回已完整发布的快照，签名游标独立于本地日志命令。"""
    return service.events(team_id, recording_id, cursor, limit)


@router.get("/recordings/{recording_id}/death-review")
def death_review(team_id: UUID, recording_id: UUID, event_id: str = Query(min_length=1, max_length=512),
                 cursor: str | None = Query(default=None, max_length=2048), limit: int = Query(default=250, ge=1, le=250),
                 refresh: bool = False, service: DeathReviewService = Depends(get_death_review)):
    """返回有明确来源的死亡窗口，鉴权、版本和读取预算由服务执行。"""
    return service.page(team_id, recording_id, event_id, cursor, limit, refresh)
