"""通过 SDK Stubber 核对 S3 协议，明确不冒充真实存储联调。"""

import json
from urllib.parse import parse_qs, urlsplit

import pytest
from botocore.stub import Stubber

from app.core.errors import DomainError
from app.services.uploads.storage import S3Storage
from app.services.uploads.validation import checksum_base64


def test_presign_uses_public_endpoint_and_binds_size_checksum(settings):
    """桌面收到可达地址，签名绑定长度和 SHA，不包含平台令牌。"""
    storage = S3Storage(settings)
    result = storage.sign_part("teams/team/recordings/video/original.mp4", "storage-id", 1, 10, "a" * 64)
    url = urlsplit(result["url"])
    assert url.netloc == "127.0.0.1:19000"
    params = parse_qs(url.query)
    assert params["X-Amz-Expires"] == ["900"]
    assert "content-length" in params["X-Amz-SignedHeaders"][0]
    assert "x-amz-checksum-sha256" in params["X-Amz-SignedHeaders"][0]
    assert result["headers"]["x-amz-checksum-sha256"] == checksum_base64("a" * 64)
    assert result["headers"]["Content-Length"] == "10"


def test_s3_list_parts_paginates_and_preserves_actual_checksum(settings):
    """不能截断第 1000 片后的服务器真值。"""
    storage = S3Storage(settings)
    with Stubber(storage.client) as stub:
        stub.add_response("list_parts", {"Parts": [{"PartNumber": 1, "Size": 5, "ETag": "etag1", "ChecksumSHA256": checksum_base64("a" * 64)}],
                                         "IsTruncated": True, "NextPartNumberMarker": 1},
                          {"Bucket": settings.s3_bucket, "Key": "key", "UploadId": "id", "PartNumberMarker": 0})
        stub.add_response("list_parts", {"Parts": [{"PartNumber": 2, "Size": 2, "ETag": "etag2", "ChecksumSHA256": checksum_base64("b" * 64)}], "IsTruncated": False},
                          {"Bucket": settings.s3_bucket, "Key": "key", "UploadId": "id", "PartNumberMarker": 1})
        assert len(storage.parts("key", "id")) == 2
        stub.assert_no_pending_responses()


def test_missing_bucket_and_missing_upload_are_distinct_safe_errors(settings):
    """未初始化桶不能被当成成功上传，会话丢失需要显式恢复。"""
    storage = S3Storage(settings)
    with Stubber(storage.client) as stub:
        stub.add_client_error("create_multipart_upload", "NoSuchBucket")
        with pytest.raises(DomainError) as error:
            storage.create("key", "recording", "team", "a" * 64)
        assert error.value.status_code == 503 and "storage-init" in error.value.detail
        stub.add_client_error("list_parts", "NoSuchUpload")
        with pytest.raises(DomainError) as error:
            storage.parts("key", "id")
        assert error.value.status_code == 409


def test_storage_initialization_refuses_public_policy_without_overwriting(settings):
    """既有桶的通配主体即使写成列表也不能作为团队私有存储。"""
    storage = S3Storage(settings)
    with Stubber(storage.client) as stub:
        stub.add_response("head_bucket", {}, {"Bucket": settings.s3_bucket})
        stub.add_response("get_bucket_acl", {"Grants": []}, {"Bucket": settings.s3_bucket})
        stub.add_response("get_bucket_policy", {"Policy": json.dumps({"Statement": [{"Effect": "Allow", "Principal": {"AWS": ["*"]}}]})}, {"Bucket": settings.s3_bucket})
        with pytest.raises(DomainError) as error:
            storage.initialize_private_bucket()
        assert error.value.status_code == 409
        stub.assert_no_pending_responses()


def test_complete_includes_actual_part_sha_and_never_uses_file_md5(settings):
    """S3 完成请求使用服务端列表得到的 ETag 与逐片 SHA。"""
    storage = S3Storage(settings)
    part = {"PartNumber": 1, "ETag": '"opaque-part-etag"', "Size": 10, "ChecksumSHA256": checksum_base64("a" * 64)}
    with Stubber(storage.client) as stub:
        stub.add_response("complete_multipart_upload", {"ETag": '"multipart-1"'}, {
            "Bucket": settings.s3_bucket, "Key": "key", "UploadId": "id",
            "MultipartUpload": {"Parts": [{key: part[key] for key in ["PartNumber", "ETag", "ChecksumSHA256"]}]},
        })
        storage.complete("key", "id", [part])
        stub.assert_no_pending_responses()
