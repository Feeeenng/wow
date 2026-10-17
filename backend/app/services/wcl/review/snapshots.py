"""死亡快照的短期Redis缓存与独立签名分页，不缓存用户授权。"""

import base64
import hashlib
import hmac
import json

from redis import Redis
from redis.exceptions import RedisError

from app.core.errors import DomainError


def seal(document: dict) -> dict:
    """完整内容参与版本摘要，重读后即使报告revision未变也不能混页。"""
    result = {**document, "revision": ""}
    result["revision"] = hashlib.sha256(json.dumps(result, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return result


class ReviewSnapshots:
    """缓存丢失可以重读来源；每个签名只对指定团队、录像、快照和死亡有效。"""

    def __init__(self, settings):
        """复用集中配置及既有部署命名空间，不保存平台或WCL令牌。"""
        self.settings = settings

    def key(self, scope: list[str]) -> str:
        """键只保留范围摘要，不暴露报告、人物及死亡身份。"""
        digest = hashlib.sha256(json.dumps(scope, separators=(",", ":")).encode()).hexdigest()
        return self.settings.processing_queue + ":death-review:" + digest

    def cached(self, scope: list[str], document: dict | None = None) -> dict | None:
        """仅ready完整快照短期缓存，Redis不可用时安全回源。"""
        if self.settings.redis_url is None:
            return None
        try:
            with Redis.from_url(self.settings.redis_url.get_secret_value(), socket_timeout=self.settings.death_review_cache_timeout_seconds,
                socket_connect_timeout=self.settings.death_review_cache_timeout_seconds) as client:
                if document is not None:
                    raw = json.dumps(document, separators=(",", ":")).encode()
                    if len(raw) <= self.settings.death_review_max_bytes:
                        client.set(self.key(scope), raw, ex=self.settings.death_review_cache_ttl_seconds)
                    return None
                raw = client.get(self.key(scope))
            if not raw or len(raw) > self.settings.death_review_max_bytes:
                return None
            result = json.loads(raw)
            if not isinstance(result, dict) or result.get("sourceKind") != "wcl" or result.get("availability") != "ready" or not isinstance(result.get("death"), dict) or result["death"].get("eventId") != scope[-1] or seal(result)["revision"] != result.get("revision"):
                return None
            return result
        except (RedisError, ValueError, TypeError, UnicodeError):
            return None

    def _secret(self) -> bytes:
        """签名用途独立于媒体grant，不允许空部署密钥。"""
        if self.settings.playback_signing_key is None:
            raise DomainError(503, "死亡分页签名尚未配置")
        return self.settings.playback_signing_key.get_secret_value().encode()

    def encode(self, scope: list[str], revision: str, offset: int) -> str:
        """签名覆盖范围、窗口内容版本和页位置。"""
        raw = json.dumps(["death-review", scope, revision, offset], separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=") + "." + hmac.new(self._secret(), raw, hashlib.sha256).hexdigest()

    def decode(self, cursor: str, scope: list[str]) -> tuple[str, int]:
        """任何跨团队、跨死亡或换版游标都不能复用。"""
        try:
            if len(cursor) > self.settings.playback_grant_max_chars:
                raise ValueError
            body, signature = cursor.split(".")
            raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
            if not hmac.compare_digest(hmac.new(self._secret(), raw, hashlib.sha256).hexdigest(), signature):
                raise ValueError
            values = json.loads(raw)
            if not isinstance(values, list) or len(values) != 4 or values[0] != "death-review" or not isinstance(values[2], str) or len(values[2]) != 64 or type(values[3]) is not int or not 0 <= values[3] <= self.settings.death_review_max_rows:
                raise ValueError
            if values[1] != scope:
                raise DomainError(409, "死亡分页范围或报告版本已变化，请重新读取")
            return values[2], values[3]
        except (ValueError, TypeError, UnicodeError):
            raise DomainError(422, "死亡分页游标无效") from None
