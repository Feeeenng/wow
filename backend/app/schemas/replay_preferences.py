"""个人显示布局只接受有界纯数据，不接收事件、身份或媒体状态。"""

import re
from uuid import UUID

from pydantic import Field, StrictFloat, StrictInt, StrictStr, field_validator, model_validator

from app.core import replay_preferences as limits
from app.schemas.recordings import ApiModel


class PersonalTrack(ApiModel):
    """规范 UUID 为稳定身份，名称按 Unicode 字符计数。"""

    id: StrictStr
    name: StrictStr = Field(min_length=1, max_length=limits.TRACK_NAME_MAX)

    @field_validator("id")
    @classmethod
    def canonical_id(cls, value: str) -> str:
        """拒绝非规范编号，避免不同表示产生悬空覆盖。"""
        if not value.startswith(limits.CUSTOM_TRACK_PREFIX) or value != limits.CUSTOM_TRACK_PREFIX + str(UUID(value[len(limits.CUSTOM_TRACK_PREFIX):])):
            raise ValueError("个人轨道编号必须为 custom- 加规范 UUID")
        return value

    @field_validator("name")
    @classmethod
    def visible_name(cls, value: str) -> str:
        """与桌面契约相同，要求已去首尾空白且无控制或无效代理字符。"""
        if not value.strip() or value != value.strip() or re.search(r"[\x00-\x1f\x7f-\x9f\ud800-\udfff]", value):
            raise ValueError("轨道名称不能包含首尾空白、控制或无效字符")
        return value


class TimelineLayout(ApiModel):
    """所有字段必须显式提供，不能通过遗漏字段意外清除已保存内容。"""

    custom_timeline_tracks: list[PersonalTrack] = Field(max_length=limits.TRACK_LIMIT)
    timeline_track_overrides: dict[StrictStr, StrictStr] = Field(max_length=limits.OVERRIDE_LIMIT)
    timeline_track_height: StrictInt = Field(ge=limits.HEIGHT_RANGE[0], le=limits.HEIGHT_RANGE[1])
    timeline_icon_percent: StrictInt = Field(ge=limits.ICON_RANGE[0], le=limits.ICON_RANGE[1])
    timeline_zoom: StrictFloat = Field(ge=limits.ZOOM_RANGE[0], le=limits.ZOOM_RANGE[1], allow_inf_nan=False)

    @model_validator(mode="after")
    def coherent_layout(self):
        """规则键严格使用真实来源格式，目标只能引用当前快照内的轨道。"""
        tracks = self.custom_timeline_tracks
        if len({item.id for item in tracks}) != len(tracks) or len({item.name.lower() for item in tracks}) != len(tracks):
            raise ValueError("个人轨道编号和名称不能重复")
        if self.timeline_zoom % limits.ZOOM_STEP:
            raise ValueError("时间轴缩放必须按 0.5 递增")
        targets = limits.DEFAULT_TRACKS | {item.id for item in tracks}
        for key, target in self.timeline_track_overrides.items():
            fields = key.split(":")
            if (not key.isascii() or len(key) > limits.OVERRIDE_KEY_BYTES or len(fields) != 4
                or fields[0] not in {"boss", "player", "team"} or not re.fullmatch(r"[0-9]+", fields[1])
                or len(fields[1]) > 10 or int(fields[1]) > limits.VERSION_MAX
                or fields[2] not in limits.EVENT_KINDS or not re.fullmatch(r"[A-Za-z0-9-]+", fields[3])
                or target not in targets):
                raise ValueError("技能显示规则或目标轨道无效")
        return self


class PutReplayPreferences(ApiModel):
    """版本必须来自本人已读取快照，不支持无条件覆盖。"""

    expected_version: StrictInt = Field(ge=0, le=limits.VERSION_MAX)
    document: TimelineLayout


def default_layout() -> dict:
    """缺行读取只生成独立默认文档，不隐式写库。"""
    return {"customTimelineTracks": [], "timelineTrackOverrides": {}, "timelineTrackHeight": limits.DEFAULT_HEIGHT,
        "timelineIconPercent": limits.DEFAULT_ICON_PERCENT, "timelineZoom": limits.DEFAULT_ZOOM}
