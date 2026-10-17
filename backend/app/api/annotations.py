"""团队视频画笔接口只负责注入、输入契约和领域服务调用。"""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_api_settings, get_principal, get_session
from app.schemas.annotations import PutAnnotations
from app.services.annotations.service import AnnotationService

router = APIRouter(prefix="/teams/{team_id}/recordings/{recording_id}/annotations", tags=["团队视频标记"])


def get_annotations(session=Depends(get_session), principal=Depends(get_principal), settings=Depends(get_api_settings)):
    """权限与 CAS 都由领域服务执行，API 不直接写 SQL。"""
    return AnnotationService(session, principal, settings)


@router.get("")
def read_annotations(team_id: UUID, recording_id: UUID, service: AnnotationService = Depends(get_annotations)):
    """团队成员读取当前完整版本。"""
    return service.get(team_id, recording_id)


@router.put("")
def write_annotations(team_id: UUID, recording_id: UUID, request: PutAnnotations,
                      service: AnnotationService = Depends(get_annotations)):
    """显式提交预期版本，冲突返回 409。"""
    return service.put(team_id, recording_id, request)
