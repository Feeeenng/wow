"""幂等登记团队录像并建立可恢复上传，不自动合并相近 Boss 战。"""

import hashlib
import json

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.recordings import Recording, TeamPull
from app.models.uploads import Upload, UploadPart
from app.schemas.recordings import RegisterRecording
from app.schemas.uploads import UploadStatus
from app.services.identity.access import AccessService, Principal
from app.services.uploads.serialization import upload_status
from app.services.uploads.validation import total_parts


class RegistrationService:
    """账号归属来自已认证身份，团队与产物版本共同参与幂等。"""

    def __init__(self, session: Session, principal: Principal, settings: Settings):
        """保存会话及当前身份，调用前不授予任何默认团队范围。"""
        self.session, self.principal, self.settings = session, principal, settings
        self.access = AccessService(session, principal)

    def register(self, request: RegisterRecording) -> UploadStatus:
        """唯一约束处理并发重试，内容变化不得复用原上传任务。"""
        self.access.require_team(request.team_id)
        if request.file_size_bytes > self.settings.max_video_bytes:
            raise DomainError(422, "录像超过服务端大小限制")
        if request.encounter_end_unix_ms - request.encounter_start_unix_ms > self.settings.max_pull_duration_ms:
            raise DomainError(422, "战斗时长超过服务端限制")
        if len(request.players) > self.settings.max_manifest_players or len(request.intervals) > self.settings.max_mapping_intervals:
            raise DomainError(422, "录像人物或映射区间超过服务端限制")
        payload = request.model_dump(mode="json", by_alias=True)
        fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        for attempt in range(2):
            try:
                return self._register(request, payload, fingerprint)
            except IntegrityError:
                self.session.rollback()
                # 重新检查当前权限，不能因为第一次获准就在被移除后继续重试。
                self.access.require_team(request.team_id)
                if attempt == 1:
                    raise DomainError(409, "并发登记冲突，请重新读取上传状态") from None
        raise AssertionError("登记重试循环应返回或抛出异常")

    def _register(self, request: RegisterRecording, payload: dict, fingerprint: str) -> UploadStatus:
        """一条数据库事务写入战斗、录像和上传任务，不提前创建 S3 分片。"""
        existing = self.session.scalar(select(Recording)
            .where(Recording.team_id.in_(self.access.team_ids()), Recording.user_id == self.principal.user_id)
            .where(Recording.team_id == request.team_id, Recording.device_id == request.device_id,
                   Recording.local_pull_id == request.local_pull_id, Recording.artifact_version == request.artifact_version))
        if existing:
            if existing.request_digest != fingerprint:
                raise DomainError(409, "相同幂等身份携带了不同录像内容或元数据")
            upload = self.session.scalar(select(Upload)
                .where(Upload.team_id.in_(self.access.team_ids()), Upload.user_id == self.principal.user_id)
                .where(Upload.recording_id == existing.id))
            if not upload:
                raise DomainError(409, "录像缺少上传任务，请由操作者检查数据")
            parts = list(self.session.scalars(select(UploadPart).join(Upload, Upload.id == UploadPart.upload_id)
                .where(Upload.team_id.in_(self.access.team_ids()), Upload.user_id == self.principal.user_id)
                .where(Upload.id == upload.id)))
            return upload_status(upload, existing, parts)
        pull = self._pull(request)
        recording = Recording(team_id=request.team_id, team_pull_id=pull.id, user_id=self.principal.user_id,
            device_id=request.device_id, local_pull_id=request.local_pull_id, artifact_version=request.artifact_version,
            request_digest=fingerprint, file_size_bytes=request.file_size_bytes, file_sha256=request.file_sha256,
            character_guid=request.character_guid, character_name=request.character_name, server_name=request.server_name,
            manifest=payload, status="pendingUpload")
        self.session.add(recording)
        self.session.flush()
        count = total_parts(request.file_size_bytes, self.settings.multipart_part_size_bytes, self.settings.max_upload_parts)
        upload = Upload(team_id=request.team_id, user_id=self.principal.user_id, recording_id=recording.id,
                        object_key=f"{self.settings.object_prefix}/{request.team_id}/recordings/{recording.id}/original.mp4",
                        part_size_bytes=self.settings.multipart_part_size_bytes, total_parts=count, status="pending")
        self.session.add(upload)
        self.session.commit()
        return upload_status(upload, recording, [])

    def _pull(self, request: RegisterRecording) -> TeamPull:
        """只接受当前团队内显式战斗或明确报告身份，未经 WCL 复核保持 unverified。"""
        query = select(TeamPull).where(TeamPull.team_id.in_(self.access.team_ids()), TeamPull.team_id == request.team_id)
        if request.team_pull_id:
            pull = self.session.scalar(query.where(TeamPull.id == request.team_pull_id))
            if not pull:
                raise DomainError(404, "指定团队战斗不存在或不在授权团队内")
        elif request.wcl_report_code:
            pull = self.session.scalar(query.where(TeamPull.wcl_report_code == request.wcl_report_code,
                                                   TeamPull.wcl_fight_id == request.wcl_fight_id))
        else:
            pull = None
        if pull:
            if pull.encounter_id != request.encounter_id or pull.difficulty_id != request.difficulty_id:
                raise DomainError(409, "指定战斗与录像首领或难度不一致")
            if request.wcl_report_code and (pull.wcl_report_code, pull.wcl_fight_id) != (request.wcl_report_code, request.wcl_fight_id):
                raise DomainError(409, "指定战斗与报告身份不一致")
            return pull
        pull = TeamPull(team_id=request.team_id, encounter_id=request.encounter_id, encounter_name=request.encounter_name,
                        difficulty_id=request.difficulty_id, started_at_unix_ms=request.encounter_start_unix_ms,
                        ended_at_unix_ms=request.encounter_end_unix_ms, wcl_report_code=request.wcl_report_code,
                        wcl_fight_id=request.wcl_fight_id, association_status="unverified")
        self.session.add(pull)
        self.session.flush()
        return pull
