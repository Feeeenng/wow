"""录像登记 HTTP 入口，业务和数据库操作在领域服务中。"""

from fastapi import APIRouter, Depends

from app.api.dependencies import get_registration
from app.schemas.recordings import RegisterRecording
from app.schemas.uploads import UploadStatus
from app.services.recordings.registration import RegistrationService

router = APIRouter(tags=["录像"])


@router.post("/recordings", response_model=UploadStatus, status_code=201)
def register_recording(request: RegisterRecording, service: RegistrationService = Depends(get_registration)):
    """仅登记视频和 manifest，客户端完整日志由 Archon 负责。"""
    return service.register(request)
