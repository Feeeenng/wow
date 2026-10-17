"""短期、用途受限的播放授权，不暴露平台令牌或 S3 凭证。"""

import base64
import binascii
import hashlib
import hmac
import json
from uuid import UUID

from app.core.config import Settings
from app.core.errors import DomainError
from app.utils.time_utils import cst_now


class PlaybackGrants:
    """授权绑定账号、团队、录像和已经发布的产物版本。"""

    def __init__(self, settings: Settings):
        """密钥仅来自服务端配置，没有默认开发密钥。"""
        self.settings = settings

    def _key(self) -> bytes:
        """缺失签名配置时不能降级成公开播放。"""
        if self.settings.playback_signing_key is None:
            raise DomainError(503, "尚未配置私有播放签名密钥")
        return self.settings.playback_signing_key.get_secret_value().encode()

    def issue(self, user_id: UUID, team_id: UUID, recording_id: UUID, version: UUID) -> str:
        """只签发短期播放用途，不承担账号登录功能。"""
        claims = {"p": "playback", "u": str(user_id), "t": str(team_id), "r": str(recording_id),
                  "v": str(version), "exp": int(cst_now().timestamp()) + self.settings.playback_url_ttl_seconds}
        payload = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":"), sort_keys=True).encode()).decode().rstrip("=")
        signature = hmac.new(self._key(), payload.encode(), hashlib.sha256).hexdigest()
        return f"{payload}.{signature}"

    def verify(self, token: str, team_id: UUID, recording_id: UUID) -> dict:
        """先常数时核验签名，再检查用途、资源、版本与有效期。"""
        try:
            if len(token) > self.settings.playback_grant_max_chars:
                raise ValueError()
            payload, actual = token.rsplit(".", 1)
            expected = hmac.new(self._key(), payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, actual):
                raise ValueError()
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if set(claims) != {"p", "u", "t", "r", "v", "exp"} or claims["p"] != "playback":
                raise ValueError()
            if claims["t"] != str(team_id) or claims["r"] != str(recording_id) or type(claims["exp"]) is not int:
                raise ValueError()
            if claims["exp"] <= int(cst_now().timestamp()):
                raise ValueError()
            claims["u"], claims["v"] = UUID(claims["u"]), UUID(claims["v"])
            return claims
        except (ValueError, TypeError, KeyError, AttributeError, UnicodeError, binascii.Error):
            raise DomainError(401, "播放授权无效或已到期，请刷新回放") from None
