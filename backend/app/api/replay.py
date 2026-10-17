"""团队战斗目录与回放 manifest 查询入口。"""

from uuid import UUID

from app.api.dependencies import get_replay
from app.services.replay.query import ReplayService
from fastapi import APIRouter, Depends, Query

router = APIRouter(prefix="/teams/{team_id}/pulls", tags=["回放"])


@router.get("")
def pulls(team_id: UUID, offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1), service: ReplayService = Depends(get_replay)):
    """返回授权团队的有界战斗目录。"""
    return service.list_pulls(team_id, offset, limit)


@router.get("/{pull_id}/replay")
def replay(team_id: UUID, pull_id: UUID, service: ReplayService = Depends(get_replay)):
    """返回真实上传和处理状态，未处理不伪造 HLS。"""
    return service.manifest(team_id, pull_id)
