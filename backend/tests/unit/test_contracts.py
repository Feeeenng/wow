"""校验上传边界、时间和 PostgreSQL 持久化契约。"""

import hashlib
from datetime import datetime

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app.core.config import Settings
from app.core.errors import DomainError
from app.db.base import Base
from app.models import annotations, identity, processing, recordings, replay_preferences, uploads, wcl
from app.schemas.recordings import RegisterRecording
from app.services.uploads.validation import checksum_base64, composite_checksum, part_size, total_parts, verify_part
from app.utils.time_utils import CST, normalize_to_cst, serialize_cst_datetime


def test_mapping_gaps_signed_offsets_and_invalid_manifest(registration):
    """合法负偏移和缺片允许；越界、重叠、原日志字段与伪身份拒绝。"""
    data = registration.model_dump(by_alias=True)
    data["intervals"] = [{"pullStartMs": 500, "pullEndMs": 1500, "videoStartMs": 0, "videoEndMs": 1000},
                         {"pullStartMs": 2000, "pullEndMs": 3000, "videoStartMs": 1000, "videoEndMs": 2000}]
    parsed = RegisterRecording.model_validate(data)
    assert parsed.video_zero_ms == -500
    for override in [{"encounterEndUnixMs": 1000}, {"wclFightId": 1}, {"characterGuid": "admin"},
                     {"combatLog": "not accepted"}, {"objectKey": "../other-team"}, {"endpoint": "https://evil.invalid"}]:
        with pytest.raises(ValidationError):
            RegisterRecording.model_validate({**data, **override})
    data["intervals"][1]["videoStartMs"] = 500
    with pytest.raises(ValidationError):
        RegisterRecording.model_validate(data)


def test_exact_part_layout_and_checksums():
    """边界末片、内容 SHA 与复合 SHA 不能混成 ETag 校验。"""
    assert total_parts(10, 5, 10000) == 2
    assert total_parts(11, 5, 10000) == 3
    assert part_size(11, 5, 3, 3) == 1
    with pytest.raises(DomainError):
        part_size(11, 5, 3, 4)
    digest = hashlib.sha256(b"video").hexdigest()
    verify_part({"Size": 5, "ChecksumSHA256": checksum_base64(digest), "ETag": '"opaque"'}, 5, digest)
    for actual in [{"Size": 4, "ChecksumSHA256": checksum_base64(digest), "ETag": "opaque"},
                   {"Size": 5, "ChecksumSHA256": checksum_base64("b" * 64), "ETag": "opaque"},
                   {"Size": 5, "ETag": digest}]:
        with pytest.raises(DomainError):
            verify_part(actual, 5, digest)
    assert composite_checksum([digest, digest]).endswith("-2")
    assert composite_checksum([digest]) != checksum_base64(digest)


def test_settings_reject_sqlite_and_request_controlled_endpoint(settings):
    """服务配置不允许 SQLite、内嵌凭证 URL 和不受控路径。"""
    data = settings.model_dump()
    for override in [{"database_url": "sqlite:///fallback.db"}, {"s3_endpoint_url": "file:///tmp"},
                     {"s3_public_endpoint_url": "http://user:password@host"}, {"s3_public_endpoint_url": "http://host/path"},
                     {"s3_bucket": "../escape"}, {"multipart_part_size_bytes": 65 * 1024**2}]:
        with pytest.raises(ValidationError):
            Settings(**{**data, **override}, _env_file=None)
    with pytest.raises(ValidationError):
        Settings(**{**data, "processing_lease_seconds": data["processing_timeout_seconds"]}, _env_file=None)


def test_postgresql_schema_has_scope_and_idempotency_constraints():
    """只编译 PostgreSQL DDL，不把模型编译当作数据库迁移成功。"""
    ddl = "\n".join(str(CreateTable(table).compile(dialect=postgresql.dialect())) for table in Base.metadata.sorted_tables)
    assert len(Base.metadata.tables) == 15
    assert "JSONB" in ddl and "TIMESTAMP WITH TIME ZONE" in ddl
    assert "uq_recording_idempotency" in ddl
    assert "fk_recording_pull_scope" in ddl
    assert "fk_upload_recording_owner_scope" in ddl
    assert "fk_replay_preferences_member_scope" in ddl and "ON DELETE CASCADE" in ddl
    assert "token_digest" in ddl and "access_token" not in ddl


def test_cst_serialization_is_explicit():
    """历史无时区值按中国标准时间解释，展示不二次转换。"""
    value = datetime(2026, 10, 17, 12, 30)
    assert normalize_to_cst(value).tzinfo == CST
    assert serialize_cst_datetime(value) == "2026-10-17 12:30:00"
