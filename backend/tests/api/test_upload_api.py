"""真实 HTTP 参数与领域服务测试，数据库和 S3 边界使用受控替身。"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_optional_principal, get_principal, get_session, get_storage
from app.main import create_app
from app.models.identity import TeamMember
from app.models.processing import ProcessingJob, ProcessingOutbox
from app.models.recordings import Recording
from app.models.uploads import Upload
from app.services.identity.access import Principal
from app.utils.time_utils import cst_now


@pytest.fixture
def client(settings):
    """仅覆盖边界依赖；请求校验、路由和业务 Service 使用生产实现。"""
    app = create_app(settings)
    session = MagicMock()
    principal = Principal(uuid4(), "测试上传者")
    storage = MagicMock()
    added = []
    session.add.side_effect = added.append

    def flush():
        """模拟数据库生成字段，只服务于无数据库的领域分支验证。"""
        for item in added:
            for name, factory in [("id", uuid4), ("created_at", cst_now), ("updated_at", cst_now)]:
                if hasattr(item, name) and getattr(item, name) is None:
                    setattr(item, name, factory())

    session.flush.side_effect = flush
    session.commit.side_effect = flush
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_storage] = lambda: storage
    with TestClient(app) as http:
        yield http, app, session, principal, storage, added


def test_register_returns_real_pending_contract_and_never_contacts_s3(client, registration):
    """新登记只建立持久任务，不伪造已上传或可播放状态。"""
    http, _, session, _, storage, added = client
    session.scalar.side_effect = [TeamMember(role="member"), None, None]
    response = http.post("/api/v1/recordings", json=registration.model_dump(mode="json", by_alias=True))
    assert response.status_code == 201, response.text
    data = response.json()
    assert data["uploadStatus"] == "pending" and data["recordingStatus"] == "pendingUpload"
    assert data["partSizeBytes"] == 64 * 1024**2
    assert data["totalParts"] == 1 and data["confirmedParts"] == []
    assert data["fullFileSha256Verified"] is False
    assert len(added) == 3
    storage.assert_not_called()
    assert not storage.method_calls


def test_nonmember_cannot_register_or_self_grant_role(client, registration):
    """提交其他团队 ID 或自报权限不能绕过成员校验。"""
    http, _, session, _, _, _ = client
    session.scalar.return_value = None
    payload = registration.model_dump(mode="json", by_alias=True)
    response = http.post("/api/v1/recordings", json=payload)
    assert response.status_code == 403
    assert not session.add.called
    response = http.post("/api/v1/recordings", json={**payload, "role": "leader"})
    assert response.status_code == 422


def test_registration_retry_reuses_task_and_rejects_changed_content(client, registration):
    """网络重试幂等，改变文件摘要必须登记新产物版本。"""
    http, _, session, _, _, added = client
    member = TeamMember(role="member")
    session.scalar.side_effect = [member, None, None]
    payload = registration.model_dump(mode="json", by_alias=True)
    first = http.post("/api/v1/recordings", json=payload)
    recording = next(item for item in added if item.__tablename__ == "recordings")
    upload = next(item for item in added if item.__tablename__ == "uploads")
    session.scalar.side_effect = [member, recording, upload]
    session.scalars.return_value = []
    repeated = http.post("/api/v1/recordings", json=payload)
    assert repeated.json()["uploadId"] == first.json()["uploadId"]
    assert len(added) == 3
    session.scalar.side_effect = [member, recording]
    changed = http.post("/api/v1/recordings", json={**payload, "fileSha256": "b" * 64})
    assert changed.status_code == 409
    assert len(added) == 3


def test_foreign_upload_is_hidden_before_storage_operation(client):
    """上传 ID 筛选前已有团队与账号范围，未知资源统一 404。"""
    http, _, session, principal, storage, _ = client
    session.execute.return_value.first.return_value = None
    response = http.post(f"/api/v1/uploads/{uuid4()}/parts", json={"partNumber": 1, "checksumSha256": "a" * 64})
    assert response.status_code == 404
    statement = session.execute.call_args[0][0]
    assert "team_members.user_id" in str(statement)
    assert principal.user_id in statement.compile().params.values()
    assert not storage.method_calls


def test_invalid_checksum_and_malformed_id_are_rejected(client):
    """边界验证先拒绝非法参数，不向 S3 签发任意请求。"""
    http, _, _, _, storage, _ = client
    response = http.post(f"/api/v1/uploads/{uuid4()}/parts", json={"partNumber": 1, "checksumSha256": "not-sha"})
    assert response.status_code == 422
    assert http.get("/api/v1/uploads/not-a-uuid/status").status_code == 422
    assert not storage.method_calls


def test_missing_bearer_and_expired_token_are_unauthorized(client):
    """HTTP 认证必须实际运行，缺失或失效令牌不默认匿名管理员。"""
    http, app, session, _, _, _ = client
    app.dependency_overrides.pop(get_principal)
    assert http.get("/api/v1/me").status_code == 401
    session.execute.return_value.first.return_value = None
    response = http.get("/api/v1/me", headers={"Authorization": "Bearer wow_" + "x" * 43})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_normal_and_chunked_request_bodies_are_bounded(client, settings):
    """无 Content-Length 的流式正文不能绕过同一个体积上限。"""
    http, _, _, _, _, _ = client
    payload = b'{"payload":"' + b"x" * settings.max_request_bytes + b'"}'
    assert http.post("/api/v1/recordings", content=payload).status_code == 413
    assert http.post("/api/v1/recordings", content=iter([payload[:1024], payload[1024:]])).status_code == 413


def test_media_cors_range_and_current_version_are_enforced(client):
    """真实 HTTP 代理保持字节范围及相对清单，过期版本在访问存储前拒绝。"""
    import io
    from botocore.response import StreamingBody
    http, app, session, principal, storage, _ = client
    app.dependency_overrides[get_optional_principal] = lambda: principal
    team, record_id, version = uuid4(), uuid4(), uuid4()
    recording = Recording(id=record_id, team_id=team, user_id=principal.user_id, status="ready", playback_version=version,
        playback_key=f"teams/{team}/recordings/{record_id}/playback/{version}/index.m3u8")
    session.scalar.return_value = recording
    storage._call.return_value = {"Body": StreamingBody(io.BytesIO(b"media"), 5), "ContentLength": 5, "ContentRange": "bytes 0-4/10"}
    path = f"/api/v1/teams/{team}/recordings/{record_id}/media/init.mp4"
    response = http.get(path, params={"version": str(version)}, headers={"Range": "bytes=0-4", "Origin": "http://tauri.localhost"})
    assert response.status_code == 206 and response.content == b"media"
    assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"
    assert response.headers["content-range"] == "bytes 0-4/10"
    assert http.get(path, params={"version": str(uuid4())}).status_code == 410
    assert storage._call.call_count == 1
    forbidden = http.options(path, headers={"Origin": "https://evil.invalid", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in forbidden.headers


def test_processing_retry_is_owner_scoped_idempotent_and_rejects_active_lease(client):
    """显式重试复用原片，已重排任务幂等，不启动第二个活跃处理者。"""
    from datetime import timedelta
    http, _, session, principal, _, _ = client
    team, record_id = uuid4(), uuid4()
    member = TeamMember(role="member")
    recording = Recording(id=record_id, team_id=team, user_id=principal.user_id, status="failed")
    job = ProcessingJob(id=uuid4(), team_id=team, recording_id=record_id, status="failed", attempts=3)
    upload = Upload(status="uploaded")
    outbox = ProcessingOutbox(job_id=job.id, attempts=1)
    session.scalar.side_effect = [member, recording, job, recording, upload]
    session.get.return_value = outbox
    path = f"/api/v1/teams/{team}/recordings/{record_id}/processing/retry"
    response = http.post(path)
    assert response.status_code == 200 and response.json()["processingStatus"] == "retrying"
    assert job.attempts == 0 and recording.status == "uploaded"
    session.scalar.side_effect = [member, recording, job, recording]
    assert http.post(path).status_code == 200
    assert session.commit.call_count == 1
    job.status = recording.status = "processing"
    job.lease_expires_at = cst_now() + timedelta(seconds=60)
    session.scalar.side_effect = [member, recording, job, recording]
    assert http.post(path).status_code == 409
