"""共享偏移的媒体覆盖、版本绑定和严格输入边界。"""

from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.calibration import PutCalibration
from app.services.replay.calibration import calibration_snapshot, has_calibrated_coverage


def manifest():
    """构造带两秒预滚的十秒战斗，不访问真实文件。"""
    return {"encounterStartUnixMs": 10000, "videoZeroMs": 2000, "videoDurationMs": 14000,
        "intervals": [], "mediaCalibrated": False, "hasGap": False, "clockDiscontinuous": False}


def test_shared_calibration_binding_and_stale_value_do_not_modify_mapping(settings):
    """发布版本变化后只停止应用，旧值及原始映射保留供复核。"""
    data = manifest(); version = uuid4()
    recording = SimpleNamespace(manifest=data, playback_version=version, status="ready")
    before = dict(data)
    assert calibration_snapshot(recording, True, settings)["version"] == 0
    data["sharedCalibration"] = {"version": 1, "playbackVersion": str(version), "offsetMs": 500}
    assert calibration_snapshot(recording, True, settings)["active"] is True
    recording.playback_version = uuid4()
    stale = calibration_snapshot(recording, False, settings)
    assert stale["stale"] and not stale["active"] and not stale["canEdit"]
    assert stale["offsetMs"] == 500 and {k: v for k, v in data.items() if k != "sharedCalibration"} == before


@pytest.mark.parametrize("offset,expected", [(0, True), (1000, True), (-2500, True), (12000, False), (-12000, False)])
def test_shared_offset_requires_some_real_combat_media(offset, expected):
    """越界偏移不能让整场失去画面，预滚尾滚不扩大战斗事实。"""
    pull = SimpleNamespace(started_at_unix_ms=10000, ended_at_unix_ms=20000)
    assert has_calibrated_coverage(manifest(), pull, offset) is expected


def test_shared_offset_does_not_invent_gaps_or_discontinuous_clock():
    """单一偏移不能修复未知缺片或跨时钟不连续。"""
    pull = SimpleNamespace(started_at_unix_ms=10000, ended_at_unix_ms=20000)
    for extra in [{"hasGap": True}, {"clockDiscontinuous": True}, {"hasGap": True, "mediaCalibrated": True}]:
        assert not has_calibrated_coverage({**manifest(), **extra}, pull, 0)
    data = {**manifest(), "hasGap": True, "mediaCalibrated": True,
        "intervals": [{"pullStartMs": 0, "pullEndMs": 1000, "videoStartMs": 0, "videoEndMs": 1000}]}
    assert has_calibrated_coverage(data, pull, 0)
    assert not has_calibrated_coverage(data, pull, -1000)


def test_shared_offset_cannot_claim_other_spliced_segments_as_available_media():
    """偏移大于各连续段时，不用其他片段或未声明的尾部冒充可用画面。"""
    pull = SimpleNamespace(started_at_unix_ms=10000, ended_at_unix_ms=20000)
    data = {**manifest(), "hasGap": True, "mediaCalibrated": True, "intervals": [
        {"pullStartMs": 0, "pullEndMs": 4000, "videoStartMs": 0, "videoEndMs": 4000},
        {"pullStartMs": 6000, "pullEndMs": 10000, "videoStartMs": 4000, "videoEndMs": 8000},
    ]}
    assert not has_calibrated_coverage(data, pull, 5000)
    assert not has_calibrated_coverage(data, pull, -5000)
    assert has_calibrated_coverage(data, pull, 500)


@pytest.mark.parametrize("field,value", [("offsetMs", True), ("offsetMs", 1.5), ("offsetMs", "100"),
    ("expectedVersion", -1), ("playbackVersion", "not-a-version"), ("canEdit", True)])
def test_calibration_request_cannot_coerce_types_or_claim_permission(field, value):
    """权限不是输入字段，错误类型在API边界拒绝。"""
    data = {"expectedVersion": 0, "playbackVersion": str(uuid4()), "offsetMs": 0, field: value}
    with pytest.raises(ValidationError):
        PutCalibration.model_validate(data)
