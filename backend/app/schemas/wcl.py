"""WCL 报告／战斗显式选择与录像视角绑定契约。"""

from uuid import UUID

from pydantic import Field, model_validator

from app.schemas.recordings import ApiModel


class WclActorBinding(ApiModel):
    """平台录像 UUID 与报告局部 actor ID 显式对应，不能冒充角色 GUID。"""

    recording_id: UUID
    actor_id: int = Field(gt=0, le=(1 << 31) - 1)


class ImportWcl(ApiModel):
    """空绑定允许先查看报告演员；没有绑定就不会猜测 SELF。"""

    report_code: str = Field(pattern=r"^[A-Za-z0-9]{16}$")
    fight_id: int = Field(gt=0, le=(1 << 31) - 1)
    actor_bindings: list[WclActorBinding] = Field(default_factory=list, max_length=100)
    refresh: bool = False

    @model_validator(mode="after")
    def unique_recordings(self):
        """同一录像不能同时声明多个自身角色，允许同一角色有多份录像。"""
        if len({binding.recording_id for binding in self.actor_bindings}) != len(self.actor_bindings):
            raise ValueError("同一录像不能重复绑定 actor")
        self.actor_bindings.sort(key=lambda binding: str(binding.recording_id))
        return self
