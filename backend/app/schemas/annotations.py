"""视频画笔纯数据契约，不接收 HTML、SVG 或用户自报权限。"""

from typing import Literal
from uuid import UUID

from pydantic import Field, StrictFloat, field_validator, model_validator

from app.schemas.recordings import ApiModel


class AnnotationPoint(ApiModel):
    """坐标相对于实际视频内容，黑边不属于 0～1 的画布。"""

    x: StrictFloat = Field(ge=0, le=1, allow_inf_nan=False)
    y: StrictFloat = Field(ge=0, le=1, allow_inf_nan=False)


class Annotation(ApiModel):
    """图形只保存有限坐标和字面文本，前端必须以文本节点绘制。"""

    id: UUID
    kind: Literal["pen", "arrow", "rect", "ellipse", "text", "marker"]
    points: list[AnnotationPoint]
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    width: StrictFloat = Field(ge=1, le=12, allow_inf_nan=False)
    text: str = ""
    at_ms: int = Field(strict=True, ge=0, le=(1 << 63) - 1)
    duration_ms: int = Field(strict=True, ge=1, le=(1 << 32) - 1)

    @field_validator("color")
    @classmethod
    def canonical_color(cls, value: str) -> str:
        """颜色规范为同一大写表示，不接受样式表达式。"""
        return value.upper()

    @field_validator("text")
    @classmethod
    def reject_nul(cls, value: str) -> str:
        """PostgreSQL JSONB 不支持 NUL；其他纯文本换行和制表符原样保留。"""
        if "\x00" in value:
            raise ValueError("标记文字不能包含 NUL 字符")
        return value

    @model_validator(mode="after")
    def valid_shape(self):
        """固定图形点数，防止不同前端把同一数据解释成不同形状。"""
        required = {"arrow": 2, "rect": 2, "ellipse": 2, "text": 1, "marker": 1}
        if self.kind == "pen" and len(self.points) < 2 or self.kind != "pen" and len(self.points) != required[self.kind]:
            raise ValueError("图形点数不符合类型约束")
        if self.kind == "text" and not self.text.strip():
            raise ValueError("文本标记必须包含可见文字")
        return self


class PutAnnotations(ApiModel):
    """客户端必须提交读取过的版本，版本不符不能静默覆盖他人修改。"""

    expected_version: int = Field(strict=True, ge=0, le=(1 << 32) - 1)
    items: list[Annotation]

    @model_validator(mode="after")
    def unique_ids(self):
        """UUID 规范化后去重，不把大小写／URN 表示当作不同标记。"""
        if len({item.id for item in self.items}) != len(self.items):
            raise ValueError("同一快照不能出现重复标记 UUID")
        return self
