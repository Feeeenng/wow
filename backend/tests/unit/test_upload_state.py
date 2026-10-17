"""上传生命周期与中断恢复的领域分支验证，不假装存在真实 PG／S3。"""

from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.core.errors import DomainError
from app.models.recordings import Recording
from app.models.uploads import Upload, UploadPart
from app.schemas.uploads import SignPart
from app.services.identity.access import Principal
from app.services.uploads.service import UploadService
from app.services.uploads.validation import checksum_base64, composite_checksum


@pytest.fixture
def task(settings):
    """提供两片真实布局：5MiB 首片与 3 字节末片。"""
    principal = Principal(uuid4(), "测试")
    recording = Recording(id=uuid4(), team_id=uuid4(), team_pull_id=uuid4(), user_id=principal.user_id,
                          file_size_bytes=5 * 1024**2 + 3, file_sha256="a" * 64, status="pendingUpload")
    upload = Upload(id=uuid4(), team_id=recording.team_id, user_id=principal.user_id, recording_id=recording.id,
                    object_key="teams/test/recordings/test/original.mp4", storage_upload_id="storage-id",
                    part_size_bytes=5 * 1024**2, total_parts=2, status="uploading")
    parts = [UploadPart(upload_id=upload.id, part_number=1, size_bytes=5 * 1024**2, checksum_sha256="b" * 64),
             UploadPart(upload_id=upload.id, part_number=2, size_bytes=3, checksum_sha256="c" * 64)]
    session, storage = MagicMock(), MagicMock()
    session.execute.return_value.first.return_value = (upload, recording)
    session.scalars.return_value = parts
    storage.head.return_value = None
    storage.parts.return_value = [{"PartNumber": part.part_number, "Size": part.size_bytes,
                                   "ChecksumSHA256": checksum_base64(part.checksum_sha256), "ETag": f"opaque-{part.part_number}"} for part in parts]
    head = {"ContentLength": recording.file_size_bytes, "Metadata": {"recording-id": str(recording.id),
            "team-id": str(recording.team_id), "file-sha256": recording.file_sha256},
            "ChecksumSHA256": composite_checksum([part.checksum_sha256 for part in parts])}
    return UploadService(session, principal, settings, storage), session, storage, upload, recording, parts, head


def test_status_recovers_received_parts_without_client_ack(task):
    """PUT 响应或 confirm 丢失时，服务端已收到的片仍可恢复。"""
    service, _, _, upload, recording, _, _ = task
    status = service.status(upload.id)
    assert len(status.confirmed_parts) == 2 and status.uploaded_bytes == recording.file_size_bytes
    assert status.upload_status == "uploading" and status.recording_status == "pendingUpload"


def test_missing_storage_session_returns_recoverable_aborted_status(task):
    """只在存储明确会话不存在时清空确认，网络错误不能误丢恢复进度。"""
    service, _, storage, upload, _, _, _ = task
    storage.parts.side_effect = DomainError(409, "missing", code="uploadSessionMissing")
    result = service.status(upload.id)
    assert result.upload_status == "aborted" and result.confirmed_parts == [] and result.uploaded_bytes == 0
    assert result.processing_error


@pytest.mark.parametrize("field,value", [("Size", 1), ("ChecksumSHA256", checksum_base64("d" * 64)), ("ETag", "")])
def test_changed_part_is_rejected_before_completion(task, field, value):
    """ETag 看似存在也不能替代真实大小和 SHA-256。"""
    service, _, storage, upload, _, _, _ = task
    storage.parts.return_value[0][field] = value
    with pytest.raises(DomainError) as error:
        service.complete(upload.id)
    assert error.value.status_code == 409
    storage.complete.assert_not_called()


def test_complete_enters_uploaded_and_is_idempotent_without_fake_ready(task):
    """确认完整对象后仅进入 uploaded，重复完成不重写原片。"""
    service, _, storage, upload, recording, _, head = task
    storage.head.side_effect = [None, None, head]
    result = service.complete(upload.id)
    assert result.upload_status == "uploaded" and recording.status == "uploaded"
    assert result.verification == "partsVerified" and not result.full_file_sha256_verified
    again = service.complete(upload.id)
    assert again.uploaded_bytes == recording.file_size_bytes
    assert storage.complete.call_count == 1


def test_completed_object_recovers_after_lost_s3_response(task):
    """完成响应丢失不能导致重复对象或永久卡在 uploading。"""
    service, _, storage, upload, _, parts, head = task
    storage.head.side_effect = [None, None]
    storage.complete.side_effect = DomainError(503, "模拟完成响应中断")
    with pytest.raises(DomainError):
        service.complete(upload.id)
    assert all(part.confirmed_at for part in parts)
    storage.head.side_effect = None
    storage.head.return_value = head
    result = service.status(upload.id)
    assert result.upload_status == "uploaded"
    assert storage.complete.call_count == 1


def test_completed_object_identity_and_composite_checksum_must_match(task):
    """即使对象大小正确，也不能采信另一条录像或另一份复合摘要。"""
    service, _, storage, upload, _, _, head = task
    service.status(upload.id)
    for bad in [{**head, "Metadata": {**head["Metadata"], "team-id": str(uuid4())}},
                {**head, "ChecksumSHA256": "wrong-2"}]:
        storage.head.return_value = bad
        with pytest.raises(DomainError) as error:
            service.complete(upload.id)
        assert error.value.status_code == 409


def test_part_content_cannot_change_and_explicit_restart_discards_old_session(task):
    """恢复保持原 SHA，用户明确重试才清空已有分片与会话。"""
    service, session, storage, upload, _, _, _ = task
    with pytest.raises(DomainError):
        service.sign(upload.id, SignPart(part_number=1, checksum_sha256="d" * 64))
    storage.sign_part.assert_not_called()
    cancelled = service.abort(upload.id)
    assert cancelled.upload_status == "aborted"
    restarted = service.abort(upload.id, restart=True)
    assert restarted.upload_status == "pending" and restarted.confirmed_parts == []
    assert upload.storage_upload_id is None and session.delete.call_count == 2
