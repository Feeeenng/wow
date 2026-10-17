"""团队死亡明细独立投影与来源快照边界，不访问线上报告。"""

from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services.wcl.adapter import WclError
from app.services.wcl.normalization import metadata, normalization_indexes
from app.services.wcl.review.normalization import recorded_number, relevant, review_event, stored_event
from app.services.wcl.review.reading import read_window


CODE = "AbCdEfGh12345678"


def source():
    """明确虚构公共报告，两个同名玩家按actor区分，报告起点不同于共同零点。"""
    report = {"code": CODE, "revision": 7, "startTime": 1_000_000, "visibility": "public",
        "fights": [{"id": 1, "startTime": 1000, "endTime": 30000, "inProgress": False, "friendlyPlayers": [1, 2], "enemyNPCs": [{"id": 3}]}],
        "masterData": {"actors": [{"id": 1, "name": "同名", "type": "Player"}, {"id": 2, "name": "同名", "type": "Player"}, {"id": 3, "name": "敌方", "type": "NPC"}],
            "abilities": [{"gameID": 123, "name": "原技能"}]}}
    _, data = metadata(report, 1, {"actorBindings": []})
    snapshot = SimpleNamespace(id=uuid4(), report_code=CODE, report_revision=7, report_started_at_unix_ms=report["startTime"], fight_id=1, metadata_json=data)
    return report, snapshot, normalization_indexes(data)


def project(raw):
    """通过纯函数读取API字段，生产数据库和网络均不参与。"""
    _, snapshot, indexes = source()
    return review_event(raw, CODE, 1_000_000, 1, snapshot.metadata_json, indexes, 1_002_000, "test-event")


def test_recorded_numbers_and_explicit_target_health():
    """未知值不补零，来源资源不能作为死者采样。"""
    for value in [None, True, -1, 1.5, float("inf"), (1 << 53)]:
        assert recorded_number({"amount": value}, "amount") is None
    assert recorded_number({"amount": 0}, "amount") == 0
    raw = {"type": "damage", "timestamp": 5000, "sourceID": -1, "targetID": 1, "amount": 0,
        "sourceResources": {"hitPoints": 99, "maxHitPoints": 100}, "abilityGameID": 123}
    result = project(raw)
    assert result["amount"] == 0 and result["overkill"] is None
    assert result["health"] is None and result["sourceActorId"] == -1
    assert result["pullTimeMs"] == 3000 and result["spellId"] == 123
    assert result["sourceGuid"] == result["targetGuid"] == ""
    raw["targetResources"] = {"hitPoints": 5, "maxHitPoints": 100}
    assert project(raw)["health"] == 5
    raw["targetResources"]["hitPoints"] = 101
    assert project(raw)["health"] is None


def test_target_scope_does_not_merge_same_names_or_other_targets():
    """同名actor与施法目标独立，数值和光环不按来源姓名纳入死者。"""
    raw = {"type": "heal", "timestamp": 5000, "sourceID": 1, "targetID": 2, "abilityGameID": 123}
    event = project(raw)
    assert not relevant(event, 1) and relevant(event, 2)
    raw["type"] = "cast"
    assert relevant(project(raw), 1)
    assert project(raw)["amount"] is None


class WindowClient:
    """模拟官方请求返回，不替换领域投影或来源核对。"""

    def __init__(self, report, pages):
        """保存明确离线报告和事件页以验证范围。"""
        self.report_value, self.values, self.queries = report, pages, []

    def report(self, code):
        """返回独立副本，允许测试最终报告变更。"""
        assert code == CODE
        return deepcopy(self.report_value)

    def pages(self, code, fight, revision, deadline, *, include_resources=False):
        """记录实际报告相对查询范围并逐页提供数据。"""
        assert code == CODE and revision == 7
        assert include_resources, "死亡窗口必须显式请求资源，不能依赖WCL默认关闭的字段"
        self.queries.append(fight)
        yield from self.values


def death_event(snapshot):
    """死亡身份引用既有发布记录，数值全部未知。"""
    raw = {"type": "death", "timestamp": 20000, "targetID": 1}
    return review_event(raw, CODE, 1_000_000, 9, snapshot.metadata_json, normalization_indexes(snapshot.metadata_json), 1_002_000, "published-death")


def test_window_time_scope_pagination_and_bounded_retention(settings):
    """报告相对范围不与共同零点混淆，截断明确披露并保留死亡身份。"""
    report, snapshot, _ = source()
    pages = [[{"type": "damage", "timestamp": 6000, "targetID": 1, "amount": 10}], [],
        [{"type": "heal", "timestamp": 19000, "targetID": 1, "amount": 5}, {"type": "death", "timestamp": 20000, "targetID": 1}]]
    client = WindowClient(report, pages)
    configured = settings.model_copy(update={"death_review_max_rows": 2})
    document = read_window(client, configured, snapshot, death_event(snapshot), 1_002_000, [], False)
    assert document["availability"] == "ready" and document["revision"]
    assert document["windowStartMs"] == 3000 and document["windowEndMs"] == 18000
    assert client.queries[0]["startTime"] == 5000 and client.queries[0]["endTime"] == 20001
    assert document["observedCount"] == 3 and document["total"] == 2 and document["truncated"]
    assert document["events"][-1]["eventId"] == "published-death"


def test_missing_or_changed_report_never_becomes_empty_success(settings):
    """换版或缺失实际死亡时，不展示完整空窗口。"""
    report, snapshot, _ = source()
    client = WindowClient(report, [[]])
    assert read_window(client, settings, snapshot, death_event(snapshot), 1_002_000, [], False)["availability"] == "reportChanged"
    report["masterData"]["actors"][0]["name"] = "已换版角色"
    client = WindowClient(report, [[]])
    assert read_window(client, settings, snapshot, death_event(snapshot), 1_002_000, [], False)["availability"] == "reportChanged"
    assert client.queries == []


def test_out_of_order_and_unknown_values_fail_closed(settings):
    """不发布乱序窗口，已存关键事件未知量显式补齐。"""
    report, snapshot, _ = source()
    client = WindowClient(report, [[{"type": "damage", "timestamp": 19000, "targetID": 1}, {"type": "damage", "timestamp": 18000, "targetID": 1}]])
    with pytest.raises(WclError, match="乱序"):
        read_window(client, settings, snapshot, death_event(snapshot), 1_002_000, [], False)
    stored = stored_event({"absoluteTimeMs": 10, "owner": "team", "classificationActorId": 1}, 5)
    assert stored["pullTimeMs"] == 5 and stored["amount"] is None and stored["health"] is None
