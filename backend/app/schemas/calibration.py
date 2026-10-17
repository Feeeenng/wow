"""团队共享对齐只提交偏移、预期版本和对应的媒体发布身份。"""

from uuid import UUID

from pydantic import Field

from app.schemas.recordings import ApiModel


class PutCalibration(ApiModel):
    """同时校验编辑版本和媒体版本，防止重处理后的旧页面误写。"""

    expected_version: int = Field(strict=True, ge=0, le=(1 << 32) - 1)
    playback_version: UUID
    offset_ms: int = Field(strict=True, ge=-(1 << 63), le=(1 << 63) - 1)
