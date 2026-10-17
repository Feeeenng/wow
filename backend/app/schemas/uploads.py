"""分片签发、恢复及最终处理状态契约。"""

from uuid import UUID

from pydantic import Field

from app.schemas.recordings import ApiModel


class SignPart(ApiModel):
    """每片 SHA-256 为小写十六进制，签发后不可换成另一份内容。"""

    part_number: int = Field(ge=1, le=10_000)
    checksum_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ConfirmedPart(ApiModel):
    """S3 已实际保存且通过大小及 SHA-256 校验的分片。"""

    part_number: int
    size_bytes: int
    checksum_sha256: str
    etag: str


class UploadStatus(ApiModel):
    """上传完成与媒体处理完成分离，不能把分片成功当成可播放。"""

    recording_id: UUID
    team_pull_id: UUID
    upload_id: UUID
    upload_status: str
    recording_status: str
    part_size_bytes: int
    total_parts: int
    confirmed_parts: list[ConfirmedPart]
    uploaded_bytes: int
    file_size_bytes: int
    verification: str
    full_file_sha256_verified: bool = False
    processing_error: str | None = None


class SignedPart(ApiModel):
    """签发地址只用于直接 PUT，不得附加平台 Bearer 令牌。"""

    part_number: int
    size_bytes: int
    url: str
    headers: dict[str, str]
    expires_in_seconds: int
