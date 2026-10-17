"""在既有录像元数据中保存版本化团队偏移，原映射字段保持不变。"""

from uuid import UUID

from sqlalchemy import select

from app.core.errors import DomainError
from app.models.identity import TeamMember
from app.models.recordings import Recording, TeamPull
from app.schemas.calibration import PutCalibration
from app.services.identity.access import AccessService
from app.services.replay.mapping import common_pull_mapping
from app.utils.time_utils import cst_now, serialize_cst_datetime


def calibration_snapshot(recording: Recording, can_edit: bool, settings) -> dict:
    """共享值仅对保存时的发布版本生效，过期值保留供明确复核。"""
    saved = recording.manifest.get("sharedCalibration") or {}
    current = str(recording.playback_version) if recording.playback_version else None
    active = bool(saved and current and recording.status == "ready" and saved["playbackVersion"] == current
                  and not recording.manifest.get("clockDiscontinuous"))
    return {"version": saved.get("version", 0), "playbackVersion": current,
        "savedPlaybackVersion": saved.get("playbackVersion"), "offsetMs": saved.get("offsetMs", 0),
        "active": active, "stale": bool(saved and not active), "canEdit": can_edit,
        "updatedAt": saved.get("updatedAt"), "minOffsetMs": -settings.shared_calibration_max_offset_ms,
        "maxOffsetMs": settings.shared_calibration_max_offset_ms}


def has_calibrated_coverage(manifest: dict, pull: TeamPull, offset_ms: int) -> bool:
    """单一偏移不能弥补未知缺片或时钟跳变，至少保留一段真实战斗画面。"""
    data = common_pull_mapping(manifest, pull.started_at_unix_ms)
    duration = pull.ended_at_unix_ms - pull.started_at_unix_ms
    if data["clockDiscontinuous"] or data["hasGap"] and (not data["mediaCalibrated"] or not data["intervals"]):
        return False
    intervals = data["intervals"] if data["mediaCalibrated"] and data["intervals"] else [{
        "pullStartMs": -data["videoZeroMs"], "pullEndMs": data["videoDurationMs"] - data["videoZeroMs"],
        "videoStartMs": 0, "videoEndMs": data["videoDurationMs"]}]
    for item in intervals:
        start, end = max(0, item["pullStartMs"]), min(duration, item["pullEndMs"])
        span = item["pullEndMs"] - item["pullStartMs"]
        if start >= end or span <= 0 or item["videoEndMs"] <= item["videoStartMs"]:
            continue
        scale = (item["videoEndMs"] - item["videoStartMs"]) / span
        video_start = item["videoStartMs"] + (start - item["pullStartMs"]) * scale + offset_ms
        video_end = item["videoStartMs"] + (end - item["pullStartMs"]) * scale + offset_ms
        if max(0, item["videoStartMs"], video_start) < min(data["videoDurationMs"], item["videoEndMs"], video_end):
            return True
    return False


class CalibrationService:
    """上传者、团长及分析员编辑，所有团队成员读取；不信任客户端权限。"""

    def __init__(self, session, principal, settings):
        """共享请求级会话与当前平台身份，不创建媒体任务或外部连接。"""
        self.session, self.principal, self.settings = session, principal, settings
        self.access = AccessService(session, principal)

    def _scope(self, team_id: UUID, recording_id: UUID, writing: bool = False):
        """先团队范围再录像，写入锁成员关系及录像，与撤权和并发编辑串行。"""
        member = self.access.require_team(team_id)
        if writing:
            member = self.session.scalar(select(TeamMember).where(TeamMember.team_id == team_id,
                TeamMember.user_id == self.principal.user_id).with_for_update().execution_options(populate_existing=True))
            if member is None:
                raise DomainError(403, "当前账号不是该团队成员")
        query = select(Recording).where(Recording.team_id.in_(self.access.team_ids()))
        query = query.where(Recording.team_id == team_id, Recording.id == recording_id)
        if writing:
            query = query.with_for_update().execution_options(populate_existing=True)
        recording = self.session.scalar(query)
        if recording is None:
            raise DomainError(404, "团队录像不存在")
        can_edit = recording.user_id == self.principal.user_id or member.role in {"leader", "analyst"}
        if writing and not can_edit:
            raise DomainError(403, "仅上传者、团长或分析员可以修改团队对齐")
        return recording, can_edit

    def get(self, team_id: UUID, recording_id: UUID) -> dict:
        """读取不写数据库，重处理后的旧校准明确失效。"""
        recording, can_edit = self._scope(team_id, recording_id)
        return calibration_snapshot(recording, can_edit, self.settings)

    def put(self, team_id: UUID, recording_id: UUID, request: PutCalibration) -> dict:
        """行锁内比较双版本后提交新快照，同版本编辑竞争最多一个成功。"""
        recording, _ = self._scope(team_id, recording_id, writing=True)
        current = calibration_snapshot(recording, True, self.settings)
        if recording.status != "ready" or recording.playback_version != request.playback_version:
            raise DomainError(409, "录像发布版本已变化或尚未就绪，请刷新后复核对齐")
        if current["version"] != request.expected_version or request.expected_version == (1 << 32) - 1:
            raise DomainError(409, "团队对齐已被其他成员修改，请重新读取后再保存")
        if abs(request.offset_ms) > self.settings.shared_calibration_max_offset_ms:
            raise DomainError(422, "团队对齐偏移超过允许范围")
        pull = self.session.scalar(select(TeamPull).where(TeamPull.team_id == team_id, TeamPull.id == recording.team_pull_id))
        if not has_calibrated_coverage(recording.manifest, pull, request.offset_ms):
            raise DomainError(422, "该偏移没有可用战斗画面，或录像存在无法校准的时钟／缺片问题")
        saved = {"version": request.expected_version + 1, "playbackVersion": str(request.playback_version),
            "offsetMs": request.offset_ms, "updatedBy": str(self.principal.user_id),
            "updatedAt": serialize_cst_datetime(cst_now())}
        recording.manifest = {**recording.manifest, "sharedCalibration": saved}
        self.session.commit()
        return calibration_snapshot(recording, True, self.settings)
