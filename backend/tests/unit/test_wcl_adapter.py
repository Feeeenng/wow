"""官方公共 API 协议与分页边界，测试不访问线上报告。"""

import json
import time

import httpx
import pytest
from pydantic import SecretStr

from app.services.wcl.adapter import WclClient, WclError, retry_delay
from app.services.wcl.normalization import metadata, normalize, serialize_event

CODE = "AbCdEfGh12345678"


def report_data(visibility="public"):
    """按官方 GraphQL 类型构造离线协议样本，不声称来自真实报告。"""
    return {"code": CODE, "visibility": visibility, "revision": 7, "startTime": 1000000, "endTime": 1010000,
        "fights": [{"id": 1, "encounterID": 1, "difficulty": 16, "startTime": 0, "endTime": 10000,
            "inProgress": False, "friendlyPlayers": [1, 2], "enemyNPCs": [{"id": 10}]}],
        "masterData": {"actors": [{"id": 1, "type": "Player", "name": "自己", "gameID": 111},
            {"id": 2, "type": "Player", "name": "队友"}, {"id": 10, "type": "NPC", "name": "首领"},
            {"id": 99, "type": "Player", "name": "其他战斗玩家"}],
            "abilities": [{"gameID": 123, "name": "测试技能", "icon": "test-icon.jpg"}]}}


def client_for(settings, responses, requests):
    """真实 httpx Request／Response 适配，仅替换网络 transport。"""
    def handle(request):
        """验证 Basic 仅用于换 token，GraphQL 使用 WCL token 而非平台 token。"""
        requests.append(request)
        if request.url.path == "/oauth/token":
            assert request.headers["Authorization"].startswith("Basic ")
            assert request.content == b"grant_type=client_credentials"
            return httpx.Response(200, json={"access_token": "offline-wcl-token", "expires_in": 3600})
        assert request.headers["Authorization"] == "Bearer offline-wcl-token"
        data = json.loads(request.content)
        assert data["variables"]["code"] == CODE
        response = responses.pop(0)
        if isinstance(response, int):
            return httpx.Response(response)
        return httpx.Response(200, json={"data": {"reportData": {"report": response}}})
    configured = settings.model_copy(update={"wcl_client_id": SecretStr("offline-client"), "wcl_client_secret": SecretStr("offline-secret")})
    return WclClient(configured, httpx.MockTransport(handle))


def test_empty_wcl_pages_follow_next_and_true_id_flags(settings):
    """空事件页不能提前停止，页查询限定 fight 并请求独立 actor／游戏技能 ID。"""
    requests = []
    responses = [{"revision": 7, "events": {"data": [], "nextPageTimestamp": 100}},
        {"revision": 7, "events": {"data": [{"type": "cast", "timestamp": 150}], "nextPageTimestamp": None}}]
    client = client_for(settings, responses, requests)
    try:
        pages = list(client.pages(CODE, {"id": 1, "startTime": 0, "endTime": 1000}, 7, time.monotonic() + 60))
        assert len(pages) == 2 and pages[0] == []
        query = json.loads(requests[-1].content)
        assert "useActorIDs:true" in query["query"] and "useAbilityIDs:true" in query["query"]
        assert query["variables"]["start"] == 100 and query["variables"]["fight"] == 1
        assert len([request for request in requests if request.url.path == "/oauth/token"]) == 1
    finally:
        client.close()


@pytest.mark.parametrize("response,match", [
    ({"revision": 7, "events": {"data": [], "nextPageTimestamp": 0}}, "游标"),
    ({"revision": 8, "events": {"data": [], "nextPageTimestamp": None}}, "版本"),
    (429, "配额"),
])
def test_non_progress_changed_revision_and_rate_limit_do_not_publish(settings, response, match):
    """不推进、重导出和配额错误均中止此次完整快照。"""
    client = client_for(settings, [response], [])
    try:
        with pytest.raises(WclError, match=match):
            list(client.pages(CODE, {"id": 1, "startTime": 0, "endTime": 1000}, 7, time.monotonic() + 60))
    finally:
        client.close()


@pytest.mark.parametrize("visibility", ["private", "unlisted"])
def test_client_credentials_never_claims_private_user_oauth(settings, visibility):
    """即使上游返回内容也拒绝非 public，不用平台令牌替代 WCL 用户授权。"""
    client = client_for(settings, [report_data(visibility)], [])
    try:
        with pytest.raises(WclError, match="仅支持"):
            client.report(CODE)
    finally:
        client.close()


def test_actor_namespace_target_semantics_and_negative_common_time():
    """施法按 source，自身光环／死亡按 target，整份报告其他玩家不猜友方。"""
    _, data = metadata(report_data(), 1, {"actorBindings": [{"recordingId": "recording", "actorId": 1}]})
    raw = {"type": "applybuff", "timestamp": 100, "sourceID": 2, "targetID": 1, "abilityGameID": 123}
    event = normalize(raw, CODE, 1000000, 1, data)
    result = serialize_event(event, 1, 1000500)
    assert result["pullTimeMs"] == -400 and result["owner"] == "player"
    assert result["sourceGuid"] == result["targetGuid"] == ""
    assert result["sourceActorId"] == 2 and result["sourceIsPlayer"] is True
    assert result["identityNamespace"] == "wcl:" + CODE and result["rawType"] == "applybuff"
    cast = normalize({**raw, "type": "cast"}, CODE, 1000000, 2, data)
    assert serialize_event(cast, 1, 1000500)["owner"] == "team"
    assert normalize({**raw, "type": "cast", "sourceID": 99}, CODE, 1000000, 3, data) is None
    with pytest.raises(WclError, match="友方 Player"):
        metadata(report_data(), 1, {"actorBindings": [{"recordingId": "recording", "actorId": 99}]})


def test_unknown_ability_id_is_not_guessed_from_report_local_number():
    """仅 abilityID 而没有游戏技能 ID 的关键事件不能静默生成假 spellID。"""
    _, data = metadata(report_data(), 1, {"actorBindings": []})
    with pytest.raises(WclError, match="游戏技能 ID"):
        normalize({"type": "cast", "timestamp": 100, "sourceID": 1, "abilityID": 42}, CODE, 1000000, 1, data)


def test_rate_limit_delay_is_bounded_and_invalid_header_is_safe(settings):
    """WCL Retry-After 进入延期任务，不通过立即重试消耗剩余配额。"""
    assert retry_delay("120", settings) == 120
    assert retry_delay("999999999", settings) == settings.wcl_max_retry_after_seconds
    assert retry_delay("invalid", settings) == settings.processing_retry_delay_seconds


def test_environment_actor_and_negative_optional_numbers_remain_readable():
    """环境 actor -1 保留为报告身份事实，可选负层数／技能不污染 u32 字段。"""
    _, data = metadata(report_data(), 1, {"actorBindings": []})
    event = normalize({"type": "death", "timestamp": 100, "sourceID": -1, "targetID": 1,
        "abilityGameID": -1, "extraAbilityGameID": -5, "stack": -2}, CODE, 1000000, 1, data)
    assert event["sourceActorId"] == -1 and event["sourceIsPlayer"] is False
    assert event["spellId"] == 0 and event["stackCount"] is None and event["extraSpellId"] is None


@pytest.mark.parametrize("limit_name,limit_value", [("wcl_max_pages", 1), ("wcl_max_raw_events", 1)])
def test_api_page_and_event_caps_reject_partial_results(settings, limit_name, limit_value):
    """触发资源上限时返回明确失败，不将已收集部分标为完整。"""
    settings = settings.model_copy(update={limit_name: limit_value})
    response = {"revision": 7, "events": {"data": [{"type": "cast"}, {"type": "cast"}], "nextPageTimestamp": 100}}
    client = client_for(settings, [response], [])
    try:
        with pytest.raises(WclError, match="超过"):
            list(client.pages(CODE, {"id": 1, "startTime": 0, "endTime": 1000}, 7, time.monotonic() + 60))
    finally:
        client.close()


@pytest.mark.parametrize("raw_type,kind,actor", [
    ("refreshbuff", "buffRefresh", 1), ("refreshdebuff", "debuffRefresh", 1),
    ("empowerstart", "empowerStart", 2), ("empowerend", "empowerEnd", 2),
    ("resurrect", "resurrect", 1),
])
def test_refresh_empower_and_resurrect_keep_distinct_kinds(raw_type, kind, actor):
    """刷新不冒充应用，蓄力按施法者、复活按被复活者决定本人视角。"""
    _, data = metadata(report_data(), 1, {"actorBindings": []})
    event = normalize({"type": raw_type, "timestamp": 100, "sourceID": 2, "targetID": 1,
        "abilityGameID": 123, "empowermentLevel": 4}, CODE, 1000000, 1, data)
    assert event["kind"] == kind and event["rawType"] == raw_type
    assert event["classificationActorId"] == actor
    assert serialize_event(event, actor, 1000000)["owner"] == "player"
    assert event["empowerLevel"] == (4 if raw_type == "empowerend" else None)
    assert data["eventSchema"] == 2


@pytest.mark.parametrize("level", [None, -1, 1.5, True, float("nan"), 2 ** 32])
def test_unknown_wcl_empower_level_remains_unknown(level):
    """线上JSON尚待实报告，缺少或非法等级不得由施法成功事件推测。"""
    _, data = metadata(report_data(), 1, {"actorBindings": []})
    event = normalize({"type": "empowerend", "timestamp": 100, "sourceID": 1,
        "abilityGameID": 123, "empowermentLevel": level}, CODE, 1000000, 1, data)
    assert event["kind"] == "empowerEnd" and event["empowerLevel"] is None
