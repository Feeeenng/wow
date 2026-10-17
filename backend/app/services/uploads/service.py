"""团队范围内的可恢复分片上传编排。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.recordings import Recording
from app.models.uploads import Upload, UploadPart
from app.schemas.uploads import SignPart, SignedPart, UploadStatus
from app.services.identity.access import AccessService, Principal
from app.services.processing.queue import enqueue_processing
from app.services.uploads.serialization import upload_status
from app.services.uploads.storage import S3Storage
from app.services.uploads.validation import composite_checksum, part_size, verify_part
from app.utils.time_utils import cst_now


class UploadService:
    """同一上传用数据库行锁串行修改，外部完成结果可从 S3 真值恢复。"""

    def __init__(self, session: Session, principal: Principal, settings: Settings, storage: S3Storage):
        """保留会话、当前用户和受配置约束的存储连接。"""
        self.session, self.principal, self.settings, self.storage = session, principal, settings, storage
        self.access = AccessService(session, principal)

    def _load(self, upload_id: UUID) -> tuple[Upload, Recording]:
        """先限制团队与上传者，再查资源 ID，避免枚举他人任务。"""
        row = self.session.execute(select(Upload, Recording).join(Recording, Recording.id == Upload.recording_id)
            .where(Upload.team_id.in_(self.access.team_ids()), Upload.user_id == self.principal.user_id)
            .where(Upload.id == upload_id).with_for_update(of=[Upload, Recording])
            .execution_options(populate_existing=True)).first()
        if not row:
            raise DomainError(404, "上传任务不存在或不属于当前账号")
        return row[0], row[1]

    def _parts(self, upload: Upload) -> list[UploadPart]:
        """分片查询同样通过上传任务应用团队及账号范围。"""
        return list(self.session.scalars(select(UploadPart).join(Upload, Upload.id == UploadPart.upload_id)
            .where(Upload.team_id.in_(self.access.team_ids()), Upload.user_id == self.principal.user_id)
            .where(Upload.id == upload.id).order_by(UploadPart.part_number)))

    def _reconcile(self, upload: Upload, recording: Recording, parts: list[UploadPart]) -> list[dict]:
        """恢复只相信存储原生 ListParts，不相信客户端的已发送标记。"""
        observed = self.storage.parts(upload.object_key, upload.storage_upload_id)
        known = {part.part_number: part for part in parts}
        seen = set()
        for actual in observed:
            number = actual.get("PartNumber")
            if number not in known or number in seen:
                raise DomainError(409, "存储中存在未签发或重复的分片")
            seen.add(number)
            expected_size = part_size(recording.file_size_bytes, upload.part_size_bytes, upload.total_parts, number)
            verify_part(actual, expected_size, known[number].checksum_sha256)
            known[number].etag, known[number].confirmed_at = actual["ETag"], cst_now()
        for number, part in known.items():
            if number not in seen:
                part.etag, part.confirmed_at = None, None
        return sorted(observed, key=lambda part: part["PartNumber"])

    def _finish_from_head(self, upload: Upload, recording: Recording, parts: list[UploadPart], head: dict) -> None:
        """S3 完成响应丢失时仍必须验证对象身份、长度及已确认分片。"""
        metadata = head.get("Metadata", {})
        if head.get("ContentLength") != recording.file_size_bytes or metadata.get("recording-id") != str(recording.id) or metadata.get("team-id") != str(recording.team_id) or metadata.get("file-sha256") != recording.file_sha256:
            raise DomainError(409, "已完成对象与登记录像的大小或身份不一致")
        confirmed = sorted((part for part in parts if part.confirmed_at and part.etag), key=lambda part: part.part_number)
        if [part.part_number for part in confirmed] != list(range(1, upload.total_parts + 1)):
            raise DomainError(409, "完成对象缺少可复核的分片确认记录")
        checksum = head.get("ChecksumSHA256")
        if checksum and checksum != composite_checksum([part.checksum_sha256 for part in confirmed]):
            raise DomainError(409, "完成对象的 Multipart 复合 SHA-256 不一致")
        upload.status = "uploaded"
        if recording.status == "pendingUpload":
            recording.status = "uploaded"
            recording.processing_error = None
        enqueue_processing(self.session, recording)

    def status(self, upload_id: UUID) -> UploadStatus:
        """恢复已上传但尚未确认的分片，服务不可用时返回真实失败。"""
        upload, recording = self._load(upload_id)
        parts = self._parts(upload)
        if upload.status == "uploading":
            head = self.storage.head(upload.object_key)
            if head:
                self._finish_from_head(upload, recording, parts, head)
            else:
                try:
                    self._reconcile(upload, recording, parts)
                except DomainError as error:
                    if error.code != "uploadSessionMissing":
                        raise
                    upload.status, recording.status = "aborted", "failed"
                    recording.processing_error = "S3 上传会话已失效，请重新开始上传"
                    for part in parts:
                        part.etag, part.confirmed_at = None, None
            self.session.commit()
        return upload_status(upload, recording, parts)

    def sign(self, upload_id: UUID, request: SignPart) -> SignedPart:
        """先持久化片号和 SHA，再向调用者返回受限签名。"""
        upload, recording = self._load(upload_id)
        if upload.status in {"uploaded", "aborted"}:
            raise DomainError(409, "该上传已完成或取消，请刷新状态")
        size = part_size(recording.file_size_bytes, upload.part_size_bytes, upload.total_parts, request.part_number)
        parts = self._parts(upload)
        part = next((part for part in parts if part.part_number == request.part_number), None)
        if part and part.checksum_sha256 != request.checksum_sha256:
            raise DomainError(409, "已签发分片不能变更 SHA-256，请重新登记不同产物")
        created_storage = None
        if not upload.storage_upload_id:
            created_storage = self.storage.create(upload.object_key, str(recording.id), str(recording.team_id), recording.file_sha256)
            upload.storage_upload_id, upload.status = created_storage, "uploading"
        if part is None:
            self.session.add(UploadPart(upload_id=upload.id, part_number=request.part_number,
                                        size_bytes=size, checksum_sha256=request.checksum_sha256))
        try:
            self.session.commit()
        except SQLAlchemyError:
            self.session.rollback()
            if created_storage:
                try:
                    self.storage.abort(upload.object_key, created_storage)
                except DomainError:
                    pass
            raise DomainError(503, "保存上传会话失败，请重新读取状态") from None
        signed = self.storage.sign_part(upload.object_key, upload.storage_upload_id, request.part_number, size, request.checksum_sha256)
        return SignedPart(part_number=request.part_number, size_bytes=size,
                          expires_in_seconds=self.settings.upload_url_ttl_seconds, **signed)

    def confirm(self, upload_id: UUID, number: int) -> UploadStatus:
        """客户端无需提交可信 ETag；只确认服务端实际可见的片。"""
        upload, recording = self._load(upload_id)
        parts = self._parts(upload)
        part_size(recording.file_size_bytes, upload.part_size_bytes, upload.total_parts, number)
        if upload.status == "uploaded":
            return upload_status(upload, recording, parts)
        if upload.status != "uploading":
            raise DomainError(409, "上传尚未开始或已取消")
        actual = self._reconcile(upload, recording, parts)
        if not any(part["PartNumber"] == number for part in actual):
            raise DomainError(409, "对象存储尚未收到该分片")
        self.session.commit()
        return upload_status(upload, recording, parts)

    def complete(self, upload_id: UUID) -> UploadStatus:
        """全部实际分片验证通过后完成对象，成功只进入待媒体处理状态。"""
        upload, recording = self._load(upload_id)
        parts = self._parts(upload)
        if upload.status == "uploaded":
            return upload_status(upload, recording, parts)
        if upload.status != "uploading":
            raise DomainError(409, "上传尚未开始或已取消")
        head = self.storage.head(upload.object_key)
        if head:
            self._finish_from_head(upload, recording, parts, head)
            self.session.commit()
            return upload_status(upload, recording, parts)
        actual = self._reconcile(upload, recording, parts)
        if [part["PartNumber"] for part in actual] != list(range(1, upload.total_parts + 1)):
            raise DomainError(409, "仍有分片未上传，不能完成录像")
        # 先保存可恢复的确认凭据，再进行不可与 PostgreSQL 原子提交的 S3 完成请求。
        self.session.commit()
        upload, recording = self._load(upload_id)
        parts = self._parts(upload)
        if upload.status == "uploaded":
            return upload_status(upload, recording, parts)
        if upload.status != "uploading":
            raise DomainError(409, "上传状态已变化，请刷新")
        head = self.storage.head(upload.object_key)
        if not head:
            self.storage.complete(upload.object_key, upload.storage_upload_id, actual)
            head = self.storage.head(upload.object_key)
        if not head:
            raise DomainError(503, "完成请求后尚未读取到录像对象，请稍后查询状态")
        self._finish_from_head(upload, recording, parts, head)
        self.session.commit()
        return upload_status(upload, recording, parts)

    def abort(self, upload_id: UUID, restart: bool = False) -> UploadStatus:
        """显式取消或重建未完成任务，禁止覆盖已完成原片。"""
        upload, recording = self._load(upload_id)
        parts = self._parts(upload)
        if upload.status == "uploaded":
            raise DomainError(409, "已经完成的录像不能重置上传")
        if upload.status == "aborted" and not restart:
            return upload_status(upload, recording, parts)
        if upload.storage_upload_id:
            head = self.storage.head(upload.object_key)
            if head:
                self._finish_from_head(upload, recording, parts, head)
                self.session.commit()
                raise DomainError(409, "原片已完成，不能取消或覆盖")
            self.storage.abort(upload.object_key, upload.storage_upload_id)
        upload.status = "pending" if restart else "aborted"
        if restart:
            for part in parts:
                self.session.delete(part)
            parts = []
            upload.storage_upload_id = None
        recording.status = "pendingUpload" if restart else "failed"
        recording.processing_error = None if restart else "上传已取消"
        self.session.commit()
        return upload_status(upload, recording, parts)
