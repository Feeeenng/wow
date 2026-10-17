"""死亡快照签名、缓存TTL及错误回源，不连接真实Redis。"""

from copy import deepcopy

from pydantic import SecretStr
import pytest
from redis.exceptions import ConnectionError

from app.core.errors import DomainError
from app.services.wcl.review.snapshots import ReviewSnapshots, seal


def test_signed_cursor_is_bound_to_exact_scope_and_content(settings):
    """签名不能跨团队／视角／死亡／版本复用，也不能伪造页位置。"""
    store = ReviewSnapshots(settings.model_copy(update={"playback_signing_key": SecretStr("offline-" + "a" * 40)}))
    scope = ["team", "recording", "snapshot", "death"]
    cursor = store.encode(scope, "b" * 64, 250)
    assert store.decode(cursor, scope) == ("b" * 64, 250)
    for position in range(4):
        other = list(scope)
        other[position] = "another"
        with pytest.raises(DomainError) as failure:
            store.decode(cursor, other)
        assert failure.value.status_code == 409
    for value in [cursor + "bad", "invalid", store.encode(scope, "b" * 64, -1), store.encode(scope, "b" * 64, True)]:
        with pytest.raises(DomainError) as failure:
            store.decode(value, scope)
        assert failure.value.status_code == 422


def test_cache_ttl_corruption_and_source_fallback(settings, monkeypatch):
    """只缓存有摘要的ready窗口，缓存故障不伪造成功或吞掉源数据错误。"""
    captured = {}

    class OfflineRedis:
        """只替换Redis协议；领域摘要与范围验证使用生产逻辑。"""

        @classmethod
        def from_url(cls, *_args, **_kwargs):
            """返回当前明确离线缓存实例。"""
            return cls()

        def __enter__(self):
            """模拟连接故障或正常进入。"""
            if captured.get("fail"):
                raise ConnectionError("offline")
            return self

        def __exit__(self, *_args):
            """不管理任何外部进程。"""
            return False

        def set(self, key, raw, ex):
            """保存实际写入字节及过期参数。"""
            captured.update(key=key, raw=raw, ttl=ex)

        def get(self, key):
            """返回原始字节以验证损坏数据处理。"""
            assert key == captured["key"]
            return captured["raw"]

    monkeypatch.setattr("app.services.wcl.review.snapshots.Redis", OfflineRedis)
    store = ReviewSnapshots(settings.model_copy(update={"redis_url": SecretStr("redis://offline:1/0")}))
    scope = ["team", "recording", "snapshot", "death"]
    document = seal({"sourceKind": "wcl", "availability": "ready", "death": {"eventId": "death"}, "events": [{"amount": 0}]})
    store.cached(scope, document)
    assert captured["ttl"] == settings.death_review_cache_ttl_seconds
    assert store.cached(scope) == document
    changed = deepcopy(document)
    changed["events"][0]["amount"] = 1
    assert seal(changed)["revision"] != document["revision"]
    captured["raw"] = b"broken-json"
    assert store.cached(scope) is None
    captured["fail"] = True
    assert store.cached(scope) is None
