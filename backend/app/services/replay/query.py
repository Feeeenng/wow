"""团队范围内查询真实战斗、视角及尚未完成的处理状态。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.recordings import Recording, TeamPull
from app.models.uploads import Upload
from app.models.wcl import WclImport, WclSnapshot
from app.services.identity.access import AccessService, Principal
from app.services.replay.grants import PlaybackGrants
from app.services.replay.mapping import common_pull_mapping
from app.services.replay.calibration import calibration_snapshot
from app.services.wcl.query import timeline_summary
from app.utils.time_utils import serialize_cst_datetime


class ReplayService:
    """未执行媒体 worker 时只报告 uploaded，不返回伪造播放地址。"""

    def __init__(self, session: Session, principal: Principal, settings: Settings):
        """保存当前账号及分页限制。"""
        self.session, self.principal, self.settings = session, principal, settings
        self.access = AccessService(session, principal)

    def list_pulls(self, team_id: UUID, offset: int, limit: int) -> list[dict]:
        """先限定成员团队，再按时间稳定分页，不扫描所有录像元数据。"""
        self.access.require_team(team_id)
        if offset < 0 or not 1 <= limit <= self.settings.list_page_limit:
            raise DomainError(422, "战斗分页参数超出服务端限制")
        pulls = self.session.scalars(select(TeamPull).where(TeamPull.team_id.in_(self.access.team_ids()))
            .where(TeamPull.team_id == team_id).order_by(TeamPull.started_at_unix_ms.desc(), TeamPull.id)
            .offset(offset).limit(limit))
        return [self._summary(pull) for pull in pulls]

    def manifest(self, team_id: UUID, pull_id: UUID) -> dict:
        """本团队所有成员可看团队视角，上传操作仍仅限各自任务。"""
        member = self.access.require_team(team_id)
        pull = self.session.scalar(select(TeamPull).where(TeamPull.team_id.in_(self.access.team_ids()))
            .where(TeamPull.team_id == team_id, TeamPull.id == pull_id))
        if not pull:
            raise DomainError(404, "团队战斗不存在")
        rows = self.session.execute(select(Recording, Upload.status).outerjoin(Upload, Upload.recording_id == Recording.id)
            .where(Recording.team_id.in_(self.access.team_ids()))
            .where(Recording.team_id == team_id, Recording.team_pull_id == pull_id).order_by(Recording.created_at, Recording.id)).all()
        standard = self.session.execute(select(WclSnapshot, WclImport.status).select_from(WclImport)
            .outerjoin(WclSnapshot, WclSnapshot.id == WclImport.snapshot_id)
            .where(WclImport.team_id == team_id, WclImport.team_pull_id == pull_id)).first()
        snapshot, wcl_status = standard if standard else (None, None)
        views = []
        for recording, upload_status in rows:
            data = recording.manifest
            views.append({"recordingId": recording.id, "characterGuid": recording.character_guid,
                "characterName": recording.character_name, "serverName": recording.server_name,
                "status": recording.status, "uploadStatus": upload_status,
                **common_pull_mapping(data, pull.started_at_unix_ms), "players": data["players"],
                "mappingQuality": "unavailable" if data.get("clockDiscontinuous") else "estimated",
                "playbackUrl": self._playback_url(recording),
                "playbackVersion": recording.playback_version,
                "success": data.get("success"), "groupSize": data.get("groupSize") or len(data["players"]),
                "canRetryProcessing": recording.status == "failed" and (recording.user_id == self.principal.user_id or member.role == "leader"),
                **timeline_summary(snapshot, recording.id, pull.started_at_unix_ms, wcl_status),
                "sharedCalibration": calibration_snapshot(recording, recording.user_id == self.principal.user_id or member.role in {"leader", "analyst"}, self.settings),
                "processingError": recording.processing_error, "updatedAt": serialize_cst_datetime(recording.updated_at)})
        return {**self._summary(pull), "views": views}

    def recordings(self, team_id: UUID, offset: int, limit: int) -> list[dict]:
        """一次 join 获取平铺视角目录，避免对每场战斗再请求一次 manifest。"""
        member = self.access.require_team(team_id)
        if offset < 0 or not 1 <= limit <= self.settings.list_page_limit:
            raise DomainError(422, "录像分页参数超出服务端限制")
        rows = self.session.execute(select(Recording, TeamPull, WclSnapshot, WclImport.status).join(TeamPull, TeamPull.id == Recording.team_pull_id)
            .outerjoin(WclImport, WclImport.team_pull_id == TeamPull.id)
            .outerjoin(WclSnapshot, WclSnapshot.id == WclImport.snapshot_id)
            .where(Recording.team_id.in_(self.access.team_ids()))
            .where(Recording.team_id == team_id).order_by(TeamPull.started_at_unix_ms.desc(), Recording.id)
            .offset(offset).limit(limit)).all()
        result = []
        for recording, pull, snapshot, wcl_status in rows:
            data = recording.manifest
            result.append({**self._summary(pull), "recordingId": recording.id, "characterGuid": recording.character_guid,
                "characterName": recording.character_name, "status": recording.status,
                **common_pull_mapping(data, pull.started_at_unix_ms), "players": data["players"],
                "processingError": recording.processing_error,
                "playbackVersion": recording.playback_version, "success": data.get("success"),
                "sharedCalibration": calibration_snapshot(recording, recording.user_id == self.principal.user_id or member.role in {"leader", "analyst"}, self.settings),
                "canRetryProcessing": recording.status == "failed" and (recording.user_id == self.principal.user_id or member.role == "leader"),
                "groupSize": data.get("groupSize") or len(data["players"]),
                **timeline_summary(snapshot, recording.id, pull.started_at_unix_ms, wcl_status)})
        return result

    def _playback_url(self, recording: Recording) -> str | None:
        """仅已发布版本可以签发短期授权，平台或 S3 令牌都不进入 URL。"""
        if recording.status != "ready" or recording.playback_version is None:
            return None
        grant = PlaybackGrants(self.settings).issue(self.principal.user_id, recording.team_id, recording.id, recording.playback_version)
        return f"{self.settings.public_api_url}/api/v1/teams/{recording.team_id}/recordings/{recording.id}/media/index.m3u8?grant={grant}"

    @staticmethod
    def _summary(pull: TeamPull) -> dict:
        """序列化对齐用毫秒与管理展示时间，界面不再转换已格式化时间。"""
        return {"teamPullId": pull.id, "teamId": pull.team_id, "encounterId": pull.encounter_id,
                "encounterName": pull.encounter_name, "difficultyId": pull.difficulty_id,
                "encounterStartUnixMs": pull.started_at_unix_ms, "encounterEndUnixMs": pull.ended_at_unix_ms,
                "associationStatus": pull.association_status, "createdAt": serialize_cst_datetime(pull.created_at)}
