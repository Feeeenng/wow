"""当前账号及明确加入的团队查询入口。"""

from fastapi import APIRouter, Depends

from app.api.dependencies import get_access
from app.services.identity.access import AccessService

router = APIRouter(tags=["账号"])


@router.get("/me")
def me(service: AccessService = Depends(get_access)):
    """不提供匿名注册或默认团队权限。"""
    return service.profile()
