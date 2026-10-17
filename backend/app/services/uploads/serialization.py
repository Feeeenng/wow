"""上传领域状态输出，不泄露 S3 会话标识或私有对象路径。"""

from app.models.recordings import Recording
from app.models.uploads import Upload, UploadPart
from app.schemas.uploads import ConfirmedPart, UploadStatus


def upload_status(upload: Upload, recording: Recording, parts: list[UploadPart]) -> UploadStatus:
    """只有已由存储确认的片才计入进度，上传完成不等于媒体 ready。"""
    confirmed = [ConfirmedPart(part_number=part.part_number, size_bytes=part.size_bytes,
                               checksum_sha256=part.checksum_sha256, etag=part.etag)
                 for part in sorted(parts, key=lambda part: part.part_number) if part.confirmed_at and part.etag]
    return UploadStatus(recording_id=recording.id, team_pull_id=recording.team_pull_id, upload_id=upload.id,
                        upload_status=upload.status, recording_status=recording.status, part_size_bytes=upload.part_size_bytes,
                        total_parts=upload.total_parts, confirmed_parts=confirmed,
                        uploaded_bytes=sum(part.size_bytes for part in confirmed), file_size_bytes=recording.file_size_bytes,
                        verification="partsVerified" if upload.status == "uploaded" else "pending",
                        full_file_sha256_verified=bool(recording.file_sha256_verified), processing_error=recording.processing_error)
