"""个人偏好接口只组合认证、输入契约与领域服务。"""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_principal, get_session
from app.schemas.replay_preferences import PutReplayPreferences
from app.services.preferences.replay import ReplayPreferenceService

router = APIRouter(prefix="/teams/{team_id}/preferences/replay", tags=["个人回放布局"])


def get_preferences(session=Depends(get_session), principal=Depends(get_principal)):
    """不接受调用方自报用户编号或权限。"""
    return ReplayPreferenceService(session, principal)


@router.get("")
def read_preferences(team_id: UUID, service: ReplayPreferenceService = Depends(get_preferences)):
    """读取当前账号在团队内的布局。"""
    return service.get(team_id)


@router.put("")
def write_preferences(team_id: UUID, request: PutReplayPreferences,
                      service: ReplayPreferenceService = Depends(get_preferences)):
    """仅以预期版本保存本人完整布局。"""
    return service.put(team_id, request)
