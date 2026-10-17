"""团队共享校准API只组合身份、输入与领域服务。"""

from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.dependencies import get_api_settings, get_principal, get_session
from app.schemas.calibration import PutCalibration
from app.services.replay.calibration import CalibrationService

router = APIRouter(prefix="/teams/{team_id}/recordings/{recording_id}/calibration", tags=["团队共享对齐"])


def get_calibration(session=Depends(get_session), principal=Depends(get_principal), settings=Depends(get_api_settings)):
    """当前团队与编辑权始终由服务端验证。"""
    return CalibrationService(session, principal, settings)


@router.get("")
def read_calibration(team_id: UUID, recording_id: UUID, service: CalibrationService = Depends(get_calibration)):
    """返回发布版本、共享值及当前编辑权限。"""
    return service.get(team_id, recording_id)


@router.put("")
def write_calibration(team_id: UUID, recording_id: UUID, request: PutCalibration,
                      service: CalibrationService = Depends(get_calibration)):
    """显式保存，版本冲突不覆盖原校准。"""
    return service.put(team_id, recording_id, request)
