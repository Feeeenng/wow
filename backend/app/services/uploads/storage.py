"""S3 协议边界，内部连接和给桌面的签名地址分开配置。"""

import json

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings
from app.core.errors import DomainError
from app.services.uploads.validation import checksum_base64


class S3Storage:
    """对象始终在私有桶中；外部异常不泄露 endpoint 凭证或签名地址。"""

    def __init__(self, settings: Settings, client=None, public_client=None):
        """测试可注入真实 SDK 的 Stubber 客户端，不用假文件系统代替 S3。"""
        self.settings = settings
        common = {"region_name": settings.s3_region,
                  "aws_access_key_id": settings.s3_access_key.get_secret_value(),
                  "aws_secret_access_key": settings.s3_secret_key.get_secret_value(),
                  "config": Config(signature_version="s3v4", s3={"addressing_style": settings.s3_addressing_style},
                                   connect_timeout=settings.s3_connect_timeout_seconds,
                                   read_timeout=settings.s3_read_timeout_seconds,
                                   retries={"max_attempts": settings.s3_retry_attempts},
                                   request_checksum_calculation="when_required", response_checksum_validation="when_required")}
        self.client = client or boto3.client("s3", endpoint_url=settings.s3_endpoint_url, **common)
        self.public_client = public_client or boto3.client("s3", endpoint_url=settings.s3_public_endpoint_url, **common)

    def close(self):
        """响应或任务结束后释放连接池，不跨请求保留已失效的外部连接。"""
        self.client.close()
        if self.public_client is not self.client:
            self.public_client.close()

    def _call(self, operation: str, **params):
        """保留可定位操作名，移除 SDK 异常中的签名和服务端私密内容。"""
        try:
            return getattr(self.client, operation)(Bucket=self.settings.s3_bucket, **params)
        except (BotoCoreError, ClientError) as error:
            code = error.response.get("Error", {}).get("Code", "") if isinstance(error, ClientError) else ""
            if code == "NoSuchBucket":
                raise DomainError(503, "对象存储桶不存在，请由操作者执行 storage-init") from None
            if code == "NoSuchUpload":
                raise DomainError(409, "S3 上传会话不存在，请显式重新开始上传", code="uploadSessionMissing") from None
            if code == "NoSuchKey":
                raise DomainError(404, "媒体对象不存在") from None
            if code == "InvalidRange":
                raise DomainError(416, "媒体范围请求无效") from None
            raise DomainError(503, f"对象存储操作 {operation} 未成功，请检查服务连接及权限") from None

    def create(self, key: str, recording_id: str, team_id: str, file_sha256: str) -> str:
        """建立 SHA-256 Multipart，不把分片 ETag 当作原片摘要。"""
        result = self._call("create_multipart_upload", Key=key, ContentType="video/mp4", ChecksumAlgorithm="SHA256",
                            Metadata={"recording-id": recording_id, "team-id": team_id, "file-sha256": file_sha256})
        return result["UploadId"]

    def sign_part(self, key: str, storage_id: str, number: int, size: int, checksum: str) -> dict:
        """签名绑定片号、长度和 SHA，绝不要求向存储发送平台令牌。"""
        encoded = checksum_base64(checksum)
        try:
            url = self.public_client.generate_presigned_url("upload_part", Params={
                "Bucket": self.settings.s3_bucket, "Key": key, "UploadId": storage_id,
                "PartNumber": number, "ContentLength": size, "ChecksumSHA256": encoded,
            }, ExpiresIn=self.settings.upload_url_ttl_seconds, HttpMethod="PUT")
        except (BotoCoreError, ClientError):
            raise DomainError(503, "签发上传地址失败，请检查对象存储配置") from None
        return {"url": url, "headers": {"x-amz-checksum-sha256": encoded, "Content-Length": str(size)}}

    def parts(self, key: str, storage_id: str) -> list[dict]:
        """完整读取 S3 原生分页，不能只把前 1000 片当成全部上传。"""
        parts, marker = [], 0
        while True:
            result = self._call("list_parts", Key=key, UploadId=storage_id, PartNumberMarker=marker)
            parts.extend(result.get("Parts", []))
            if len(parts) > self.settings.max_upload_parts:
                raise DomainError(503, "对象存储返回分片数超过限制")
            if not result.get("IsTruncated"):
                break
            next_marker = result.get("NextPartNumberMarker", 0)
            if next_marker <= marker or len(parts) > self.settings.max_upload_parts:
                raise DomainError(503, "对象存储分片分页返回异常")
            marker = next_marker
        return parts

    def head(self, key: str) -> dict | None:
        """完成超时后从对象真值恢复，缺失对象与存储故障严格区分。"""
        try:
            return self.client.head_object(Bucket=self.settings.s3_bucket, Key=key, ChecksumMode="ENABLED")
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "NoSuchBucket":
                raise DomainError(503, "对象存储桶不存在，请由操作者执行 storage-init") from None
            if error.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise DomainError(503, "读取对象存储完成状态失败，请检查服务连接及权限") from None
        except BotoCoreError:
            raise DomainError(503, "对象存储连接不可用") from None

    def complete(self, key: str, storage_id: str, parts: list[dict]) -> None:
        """提交服务端已经核对过的分片顺序及校验和。"""
        self._call("complete_multipart_upload", Key=key, UploadId=storage_id,
                   MultipartUpload={"Parts": [{"PartNumber": part["PartNumber"], "ETag": part["ETag"],
                                               "ChecksumSHA256": part["ChecksumSHA256"]} for part in parts]})

    def abort(self, key: str, storage_id: str) -> None:
        """明确取消尚未完成的 Multipart，重复取消保持幂等。"""
        try:
            self.client.abort_multipart_upload(Bucket=self.settings.s3_bucket, Key=key, UploadId=storage_id)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") != "NoSuchUpload":
                raise DomainError(503, "中止对象存储上传失败") from None
        except BotoCoreError:
            raise DomainError(503, "中止上传时对象存储连接不可用") from None

    def initialize_private_bucket(self) -> bool:
        """显式创建缺失私有桶；既有公开策略或 ACL 被拒绝，不覆盖其配置。"""
        created = False
        try:
            self.client.head_bucket(Bucket=self.settings.s3_bucket)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") not in {"404", "NoSuchBucket", "NotFound"}:
                raise DomainError(503, "无法检查存储桶，请核对初始化权限") from None
            params = {} if self.settings.s3_region == "us-east-1" else {"CreateBucketConfiguration": {"LocationConstraint": self.settings.s3_region}}
            self._call("create_bucket", **params)
            created = True
        except BotoCoreError:
            raise DomainError(503, "初始化时对象存储连接不可用") from None
        acl = self._call("get_bucket_acl")
        for grant in acl.get("Grants", []):
            if grant.get("Grantee", {}).get("URI", "").endswith(("/AllUsers", "/AuthenticatedUsers")):
                raise DomainError(409, "存储桶存在公开 ACL，拒绝用于团队私有录像")
        try:
            result = self.client.get_bucket_policy(Bucket=self.settings.s3_bucket)
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "NoSuchBucketPolicy":
                return created
            raise DomainError(503, "无法检查存储桶策略，请核对初始化权限") from None
        except BotoCoreError:
            raise DomainError(503, "读取桶策略时对象存储连接不可用") from None
        policy = json.loads(result["Policy"])
        for statement in policy.get("Statement", []):
            principal = statement.get("Principal")
            public = principal == "*" or isinstance(principal, dict) and any(
                value == "*" or isinstance(value, list) and "*" in value for value in principal.values())
            if statement.get("Effect") == "Allow" and public:
                raise DomainError(409, "存储桶存在公开访问策略，请先由操作者处理")
        return created
