"""可恢复上传 API，不在接口层计算分片或访问数据库。"""

from uuid import UUID

from fastapi import APIRouter, Depends, Path

from app.api.dependencies import get_uploads
from app.schemas.uploads import SignPart, SignedPart, UploadStatus
from app.services.uploads.service import UploadService

router = APIRouter(prefix="/uploads", tags=["上传"])


@router.get("/{upload_id}/status", response_model=UploadStatus)
def status(upload_id: UUID, service: UploadService = Depends(get_uploads)):
    """从服务端确认状态恢复上传进度。"""
    return service.status(upload_id)


@router.post("/{upload_id}/parts", response_model=SignedPart)
def sign(upload_id: UUID, request: SignPart, service: UploadService = Depends(get_uploads)):
    """签发指定片号和 SHA 的 PUT 地址。"""
    return service.sign(upload_id, request)


@router.post("/{upload_id}/parts/{part_number}/confirm", response_model=UploadStatus)
def confirm(upload_id: UUID, part_number: int = Path(ge=1, le=10_000), service: UploadService = Depends(get_uploads)):
    """忽略客户端 ETag 自报，由领域服务检查 S3 真值。"""
    return service.confirm(upload_id, part_number)


@router.post("/{upload_id}/complete", response_model=UploadStatus)
def complete(upload_id: UUID, service: UploadService = Depends(get_uploads)):
    """完整对象校验通过后才确认上传完成。"""
    return service.complete(upload_id)


@router.post("/{upload_id}/abort", response_model=UploadStatus)
def abort(upload_id: UUID, service: UploadService = Depends(get_uploads)):
    """显式中止尚未完成的 Multipart。"""
    return service.abort(upload_id)


@router.post("/{upload_id}/restart", response_model=UploadStatus)
def restart(upload_id: UUID, service: UploadService = Depends(get_uploads)):
    """用户显式重试时重新开始，禁止覆盖已完成原片。"""
    return service.abort(upload_id, restart=True)
