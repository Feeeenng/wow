"""视频画笔纯数据契约、形状和输入边界。"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.schemas.annotations import Annotation, PutAnnotations


def item(kind="pen") -> dict:
    """生成只含公开字段的最小标记，无用户或权限自报信息。"""
    return {"id": str(uuid4()), "kind": kind, "points": [{"x": 0.1, "y": 0.2}, {"x": 0.8, "y": 0.9}],
        "color": "#ff6600", "width": 2, "text": "", "atMs": 1000, "durationMs": 5000}


@pytest.mark.parametrize("kind,count", [("pen", 2), ("arrow", 2), ("rect", 2), ("ellipse", 2), ("text", 1), ("marker", 1)])
def test_shape_contract_is_explicit_and_color_canonical(kind, count):
    """六种图形点数固定，文本为字面值，规范颜色不会影响绘制次序。"""
    data = item(kind)
    data["points"] = data["points"][:count]
    data["text"] = '<script>只显示文字</script>' if kind == "text" else ""
    parsed = Annotation.model_validate(data)
    assert parsed.color == "#FF6600" and parsed.text == data["text"]
    data["points"] = []
    with pytest.raises(ValidationError):
        Annotation.model_validate(data)


@pytest.mark.parametrize("changes", [
    {"points": [{"x": float("nan"), "y": 0}, {"x": 1, "y": 1}]},
    {"points": [{"x": float("inf"), "y": 0}, {"x": 1, "y": 1}]},
    {"points": [{"x": -0.1, "y": 0}, {"x": 1, "y": 1}]},
    {"points": [{"x": True, "y": 0}, {"x": 1, "y": 1}]},
    {"color": "url(javascript:alert(1))"}, {"width": float("nan")}, {"width": True}, {"width": 0},
    {"width": 13}, {"atMs": -1}, {"atMs": 0.5}, {"durationMs": -1}, {"durationMs": True},
    {"svg": "<path/>"}, {"userId": str(uuid4())}, {"kind": "image"},
    {"kind": "text", "points": [{"x": 0, "y": 0}], "text": "  "},
])
def test_invalid_geometry_and_unknown_fields_are_rejected(changes):
    """非有限值、越界、布尔伪数字和可执行载荷字段不能进入保存层。"""
    with pytest.raises(ValidationError):
        Annotation.model_validate({**item(), **changes})


def test_uuid_canonical_duplicates_and_version_bounds():
    """UUID 大小写／URN 不能绕过去重，版本必须为 u32 整数。"""
    first = item()
    second = {**first, "id": "urn:uuid:" + first["id"].upper()}
    with pytest.raises(ValidationError):
        PutAnnotations(expectedVersion=0, items=[first, second])
    for version in [-1, 1 << 32, True, 1.5]:
        with pytest.raises(ValidationError):
            PutAnnotations(expectedVersion=version, items=[])
