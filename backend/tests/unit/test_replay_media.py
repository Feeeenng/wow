"""播放用途、版本隔离、成员撤销和 HLS 授权传播。"""

import io
from datetime import timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from botocore.response import StreamingBody
from pydantic import SecretStr

from app.core.errors import DomainError
from app.models.recordings import Recording
from app.services.identity.access import Principal
from app.services.replay.grants import PlaybackGrants
from app.services.replay.media import ReplayMediaService, authorized_playlist, valid_media_name
from app.utils.time_utils import cst_now


def test_grant_tamper_expiry_and_cross_resource_are_rejected(settings):
    """授权不能跨账号用途或资源复用，也不能越过有效期。"""
    settings = settings.model_copy(update={"playback_signing_key": SecretStr("test-signing-key-" + "x" * 32)})
    user, team, recording, version = [uuid4() for _ in range(4)]
    grants = PlaybackGrants(settings)
    token = grants.issue(user, team, recording, version)
    assert grants.verify(token, team, recording)["u"] == user
    tampered = token[:-1] + ("0" if token[-1] != "0" else "1")
    for candidate, target in [(tampered, team), (token, uuid4())]:
        with pytest.raises(DomainError) as error:
            grants.verify(candidate, target, recording)
        assert error.value.status_code == 401
    with patch("app.services.replay.grants.cst_now", return_value=cst_now() + timedelta(seconds=301)):
        with pytest.raises(DomainError):
            grants.verify(token, team, recording)


def test_playlist_propagates_grant_to_init_and_segments_but_bearer_is_relative():
    """初始化段不能丢授权，外部 URL 与路径穿越都不能被代理。"""
    playlist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nsegment-00000.m4s\n#EXT-X-ENDLIST\n'
    assert authorized_playlist(playlist, None) == playlist
    rewritten = authorized_playlist(playlist, "safe-grant")
    assert 'URI="init.mp4?grant=safe-grant"' in rewritten
    assert "segment-00000.m4s?grant=safe-grant" in rewritten
    for name in ["../source.mp4", "segment-00000.m4s/other", "https://evil.invalid/a.m4s", "source.mp4", "segment-0000.m4s"]:
        assert not valid_media_name(name)
    with pytest.raises(DomainError):
        authorized_playlist(playlist.replace("segment-00000.m4s", "https://evil.invalid/a.m4s"), "safe")


def test_current_membership_ready_and_version_guard_every_fragment(settings):
    """移出团队或停用账号立即拒绝，旧版本在访问 S3 前返回 410。"""
    settings = settings.model_copy(update={"playback_signing_key": SecretStr("test-signing-key-" + "x" * 32)})
    user, team, record_id, version = [uuid4() for _ in range(4)]
    recording = Recording(id=record_id, team_id=team, user_id=user, status="ready", playback_version=version,
                          playback_key=f"teams/{team}/recordings/{record_id}/playback/{version}/index.m3u8")
    session, storage = MagicMock(), MagicMock()
    session.scalar.return_value = recording
    body = b"valid-media-test"
    storage._call.return_value = {"Body": StreamingBody(io.BytesIO(body), len(body)), "ContentLength": len(body)}
    service = ReplayMediaService(session, settings, storage, Principal(user, "测试"))
    result = service.open(team, record_id, "init.mp4", None, version, None)
    assert b"".join(result.body) == body
    sql = str(session.scalar.call_args[0][0])
    assert "team_members.user_id" in sql and "users.active" in sql
    with pytest.raises(DomainError) as error:
        service.open(team, record_id, "init.mp4", None, uuid4(), None)
    assert error.value.status_code == 410
    assert storage._call.call_count == 1
    token = PlaybackGrants(settings).issue(user, team, record_id, version)
    session.scalar.return_value = None
    anonymous = ReplayMediaService(session, settings, storage, None)
    with pytest.raises(DomainError) as error:
        anonymous.open(team, record_id, "segment-00000.m4s", token, None, None)
    assert error.value.status_code == 404
    assert storage._call.call_count == 1
