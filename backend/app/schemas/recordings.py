"""客户端视频 manifest 的最小受限输入，禁止上传任意路径或日志对象。"""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """JSON 使用 camelCase；未知字段拒绝，避免暗中接收未经约定的对象。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Player(ApiModel):
    """角色信息仅作展示，不授予账号或团队权限。"""

    guid: str = Field(min_length=1, max_length=128, pattern=r"^Player-[A-Za-z0-9-]+$")
    name: str = Field(min_length=1, max_length=128)
    server_name: str | None = Field(default=None, max_length=128)
    full_type: str | None = Field(default=None, max_length=128)


class MappingInterval(ApiModel):
    """有画面的连续区间，允许真实缺口，不能以拼接时长覆盖缺片。"""

    pull_start_ms: int = Field(ge=-(1 << 63), le=(1 << 63) - 1)
    pull_end_ms: int = Field(ge=-(1 << 63), le=(1 << 63) - 1)
    video_start_ms: int = Field(ge=0, le=(1 << 63) - 1)
    video_end_ms: int = Field(gt=0, le=(1 << 63) - 1)

    @model_validator(mode="after")
    def ordered(self):
        """连续映射必须具有正长度，比例校准由媒体处理阶段复核。"""
        if self.pull_end_ms <= self.pull_start_ms or self.video_end_ms <= self.video_start_ms:
            raise ValueError("映射区间必须具有正长度")
        return self


class RegisterRecording(ApiModel):
    """幂等登记一份已结束的 MP4 及同步事实，不接收原始 CombatLog。"""

    team_id: UUID
    team_pull_id: UUID | None = None
    device_id: str = Field(min_length=1, max_length=128)
    local_pull_id: str = Field(min_length=1, max_length=128)
    artifact_version: str = Field(min_length=1, max_length=128)
    file_size_bytes: int = Field(gt=0)
    file_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    character_guid: str = Field(pattern=r"^Player-[A-Za-z0-9-]+$", max_length=128)
    character_name: str = Field(min_length=1, max_length=128)
    server_name: str | None = Field(default=None, max_length=128)
    encounter_id: int = Field(gt=0, le=(1 << 31) - 1)
    encounter_name: str = Field(min_length=1, max_length=256)
    difficulty_id: int = Field(ge=0, le=(1 << 31) - 1)
    encounter_start_unix_ms: int = Field(ge=0, le=(1 << 63) - 1)
    encounter_end_unix_ms: int = Field(gt=0, le=(1 << 63) - 1)
    video_zero_ms: int = Field(ge=-(1 << 63), le=(1 << 63) - 1)
    video_duration_ms: int = Field(gt=0, le=(1 << 63) - 1)
    media_calibrated: bool = False
    clock_discontinuous: bool = False
    calibration_error: str | None = Field(default=None, max_length=512)
    has_gap: bool = False
    success: bool | None = None
    group_size: int | None = Field(default=None, ge=1, le=100)
    wcl_report_code: str | None = Field(default=None, pattern=r"^[A-Za-z0-9]{16}$")
    wcl_fight_id: int | None = Field(default=None, gt=0)
    players: list[Player] = Field(default_factory=list)
    intervals: list[MappingInterval] = Field(default_factory=list)

    @model_validator(mode="after")
    def consistent(self):
        """起止和报告身份成对有效，人物及视频映射不能重复或越界。"""
        if self.encounter_end_unix_ms <= self.encounter_start_unix_ms:
            raise ValueError("战斗结束必须晚于开始")
        if (self.wcl_report_code is None) != (self.wcl_fight_id is None):
            raise ValueError("WCL reportCode 与 fightId 必须成对提供")
        if len({player.guid for player in self.players}) != len(self.players):
            raise ValueError("参战角色 GUID 不能重复")
        previous = None
        for interval in self.intervals:
            if interval.video_end_ms > self.video_duration_ms:
                raise ValueError("映射超出视频时长")
            if previous and (interval.pull_start_ms < previous.pull_end_ms or interval.video_start_ms < previous.video_end_ms):
                raise ValueError("映射区间必须按顺序且不能重叠")
            previous = interval
        return self
