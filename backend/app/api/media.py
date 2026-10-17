"""受团队与版本限制的媒体入口，路由不解释存储路径。"""

from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import Response, StreamingResponse

from app.api.dependencies import get_processing_retry, get_replay, get_replay_media
from app.services.processing.retry import ProcessingRetryService
from app.services.replay.media import ReplayMediaService
from app.services.replay.query import ReplayService

router = APIRouter(prefix="/teams/{team_id}/recordings", tags=["团队媒体"])


@router.get("")
def recordings(team_id: UUID, offset: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1),
               service: ReplayService = Depends(get_replay)):
    """返回有界平铺目录，不加载任何媒体正文。"""
    return service.recordings(team_id, offset, limit)


@router.get("/{recording_id}/media/{filename}")
def media(team_id: UUID, recording_id: UUID, filename: str, grant: str | None = None,
          version: UUID | None = None, range_value: str | None = Header(default=None, alias="Range"),
          service: ReplayMediaService = Depends(get_replay_media)):
    """Bearer 代理保留相对引用，Web grant 清单向子片传播同一短期授权。"""
    result = service.open(team_id, recording_id, filename, grant, version, range_value)
    response = StreamingResponse if result.streaming else Response
    return response(result.body, media_type=result.media_type, headers=result.headers, status_code=result.status_code)


@router.post("/{recording_id}/processing/retry")
def retry(team_id: UUID, recording_id: UUID, service: ProcessingRetryService = Depends(get_processing_retry)):
    """上传者或团长重试失败媒体任务，不重新上传或覆盖原片。"""
    return service.retry(team_id, recording_id)
