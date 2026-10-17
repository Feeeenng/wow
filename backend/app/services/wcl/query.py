"""团队 WCL 状态与绑定视角的不可伪造有界事件分页。"""

import base64
import hashlib
import hmac
import json
from uuid import UUID

from sqlalchemy import select

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.recordings import Recording, TeamPull
from app.models.wcl import WclEvent, WclImport, WclSnapshot
from app.services.identity.access import AccessService, Principal
from app.services.wcl.adapter import configured
from app.services.wcl.normalization import serialize_event


def event_revision(snapshot: WclSnapshot | None, recording_id: UUID, common_start: int) -> str | None:
    """不可变快照加视角／绑定／共同零点，切换视角不能复用原分类分页。"""
    if snapshot is None:
        return None
    values = [str(snapshot.id), str(recording_id), snapshot.metadata_json["actorBindings"], common_start]
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def timeline_summary(snapshot: WclSnapshot | None, recording_id: UUID, common_start: int, status: str | None) -> dict:
    """处理失败有旧完整版本时仍明确提供旧版，未导入则不伪造完整空场。"""
    return {"timelineRevision": event_revision(snapshot, recording_id, common_start),
        "timelineEventCount": snapshot.event_count if snapshot else 0, "timelineComplete": snapshot is not None,
        "wclStatus": status or "unbound"}


class WclQueryService:
    """只读当前成员团队的已发布快照，不暴露临时导入事件。"""

    def __init__(self, session, principal: Principal, settings: Settings):
        """绑定请求级认证与集中分页上限。"""
        self.session, self.principal, self.settings = session, principal, settings
        self.access = AccessService(session, principal)

    def pull(self, team_id: UUID, pull_id: UUID, lock: bool = False) -> TeamPull:
        """先成员范围再查资源；导入时可锁定共同 Pull 防止并发改绑。"""
        self.access.require_team(team_id)
        query = select(TeamPull).where(TeamPull.team_id.in_(self.access.team_ids()))
        query = query.where(TeamPull.team_id == team_id, TeamPull.id == pull_id)
        pull = self.session.scalar(query.with_for_update() if lock else query)
        if not pull:
            raise DomainError(404, "团队战斗不存在")
        return pull

    def status(self, team_id: UUID, pull_id: UUID) -> dict:
        """账号角色决定可导入，服务端缺凭证时公开 disabled 事实。"""
        member = self.access.require_team(team_id)
        self.pull(team_id, pull_id)
        job = self.session.scalar(select(WclImport).where(WclImport.team_id.in_(self.access.team_ids()))
            .where(WclImport.team_id == team_id, WclImport.team_pull_id == pull_id))
        snapshot = self.session.get(WclSnapshot, job.snapshot_id) if job and job.snapshot_id else None
        request = job.request_json if job else {}
        return {"configured": configured(self.settings), "canImport": member.role in {"leader", "analyst"},
            "status": job.status if job else "unbound", "jobId": job.id if job else None,
            "reportCode": request.get("reportCode"), "fightId": request.get("fightId"),
            "revision": str(snapshot.id) if snapshot else None, "eventCount": snapshot.event_count if snapshot else 0,
            "rawEventCount": snapshot.raw_event_count if snapshot else 0,
            "actors": snapshot.metadata_json["actors"] if snapshot else [],
            "actorBindings": snapshot.metadata_json["actorBindings"] if snapshot else [],
            "publishedReportCode": snapshot.report_code if snapshot else None,
            "publishedReportRevision": snapshot.report_revision if snapshot else None,
            "publishedFightId": snapshot.fight_id if snapshot else None,
            "error": job.last_error if job else None}

    def _key(self) -> bytes:
        """与媒体共享部署密钥但区分签名用途，不能将 grant 当事件游标。"""
        if self.settings.playback_signing_key is None:
            raise DomainError(503, "事件分页签名密钥尚未配置")
        return self.settings.playback_signing_key.get_secret_value().encode()

    def _encode(self, scope: list, offset: int) -> str:
        """签名含 team／recording／版本／分类摘要／位置，避免游标跨视角复用。"""
        raw = json.dumps(["wcl-events", *scope, offset], separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=") + "." + hmac.new(self._key(), raw, hashlib.sha256).hexdigest()

    def _decode(self, cursor: str) -> list:
        """常数时验签，拒绝格式和位置越界，不回显游标正文。"""
        try:
            if len(cursor) > self.settings.playback_grant_max_chars:
                raise ValueError
            body, signature = cursor.split(".")
            raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4))
            if not hmac.compare_digest(hmac.new(self._key(), raw, hashlib.sha256).hexdigest(), signature):
                raise ValueError
            values = json.loads(raw)
            if len(values) != 5 or values[0] != "wcl-events" or type(values[-1]) is not int or values[-1] < 0:
                raise ValueError
            return values
        except (ValueError, TypeError, json.JSONDecodeError):
            raise DomainError(422, "WCL 事件游标无效") from None

    def events(self, team_id: UUID, recording_id: UUID, cursor: str | None, limit: int | None) -> dict:
        """完整导入后稳定按时间和原始顺序分页，旧版游标明确要求重置。"""
        self.access.require_team(team_id)
        if limit is None:
            limit = min(self.settings.wcl_event_page_default, self.settings.wcl_event_page_limit)
        if not 1 <= limit <= self.settings.wcl_event_page_limit:
            raise DomainError(422, "事件分页数量超出限制")
        row = self.session.execute(select(Recording, TeamPull, WclSnapshot)
            .join(TeamPull, TeamPull.id == Recording.team_pull_id)
            .outerjoin(WclImport, WclImport.team_pull_id == TeamPull.id)
            .outerjoin(WclSnapshot, WclSnapshot.id == WclImport.snapshot_id)
            .where(Recording.team_id.in_(self.access.team_ids()))
            .where(Recording.team_id == team_id, Recording.id == recording_id)).first()
        if not row:
            raise DomainError(404, "团队录像不存在")
        recording, pull, snapshot = row
        if snapshot is None:
            raise DomainError(409, "该战斗尚无完整 WCL 事件版本，请先导入公共报告")
        revision = event_revision(snapshot, recording.id, pull.started_at_unix_ms)
        scope = [str(team_id), str(recording_id), revision]
        offset, reset = 0, False
        if cursor:
            decoded = self._decode(cursor)
            if decoded[1:4] != scope:
                reset = True
            else:
                offset = decoded[-1]
                if offset > snapshot.event_count:
                    raise DomainError(422, "事件游标位置超出完整版本")
        # PK 稳定序号已在发布时按绝对时间／原始 ordinal 排序，查询走复合索引。
        rows = self.session.scalars(select(WclEvent).where(WclEvent.snapshot_id == snapshot.id,
            WclEvent.ordinal >= offset).order_by(WclEvent.ordinal).limit(limit)).all()
        own = next((binding["actorId"] for binding in snapshot.metadata_json["actorBindings"]
            if binding["recordingId"] == str(recording_id)), None)
        events = [serialize_event(event.payload, own, pull.started_at_unix_ms) for event in rows]
        next_offset = offset + len(events)
        return {"revision": revision, "events": events, "total": snapshot.event_count,
            "nextCursor": self._encode(scope, next_offset), "hasMore": next_offset < snapshot.event_count, "reset": reset}
