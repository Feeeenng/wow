"""授权团队录像的按需死亡复盘，既有数据库结构及时间轴发布保持兼容。"""

from sqlalchemy import select

from app.core.errors import DomainError
from app.models.recordings import Recording, TeamPull
from app.models.wcl import WclEvent, WclImport, WclSnapshot
from app.services.identity.access import AccessService
from app.services.wcl.adapter import WclClient, WclError, configured
from app.services.wcl.review.normalization import stored_event
from app.services.wcl.review.reading import read_window
from app.services.wcl.review.snapshots import ReviewSnapshots, seal


class DeathReviewService:
    """每页先重新鉴权与解析发布快照，再使用缓存或读取官方公共报告。"""

    def __init__(self, session, principal, settings, client_factory=WclClient):
        """生产通过固定服务端凭证访问WCL，协议测试可注入HTTP客户端。"""
        self.session, self.settings, self.client_factory = session, settings, client_factory
        self.access = AccessService(session, principal)
        self.snapshots = ReviewSnapshots(settings)

    def _scope(self, team_id, recording_id, event_id):
        """先限制团队，再解析录像、已发布版本和明确玩家死亡，不按同名匹配。"""
        self.access.require_team(team_id)
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
            raise DomainError(409, "该战斗尚无完整WCL事件版本，请先导入公共报告")
        death = self.session.scalar(select(WclEvent).where(WclEvent.snapshot_id == snapshot.id,
            WclEvent.payload["eventId"].astext == event_id))
        if death is None or death.payload.get("kind") != "death" or death.payload.get("targetIsPlayer") is not True or not death.payload.get("targetActorId"):
            raise DomainError(404, "该发布版本中没有指定玩家死亡记录")
        event = stored_event(death.payload, pull.started_at_unix_ms)
        if event["pullTimeMs"] < 0:
            raise DomainError(404, "该死亡记录不在当前共同战斗时间范围内")
        return recording, pull, snapshot, event

    def _prior(self, snapshot, death, start):
        """仅取已发布关键事件中窗口前的有界光环，不能冒充开战前完整状态。"""
        rows = self.session.scalars(select(WclEvent).where(WclEvent.snapshot_id == snapshot.id,
            WclEvent.absolute_time_ms < start, WclEvent.payload["targetActorId"].as_integer() == death["targetActorId"],
            WclEvent.payload["kind"].astext.in_(["buffApply", "buffRefresh", "buffStack", "buffRemove", "debuffApply", "debuffRefresh", "debuffStack", "debuffRemove"]))
            .order_by(WclEvent.ordinal.desc()).limit(self.settings.death_review_prior_aura_limit + 1)).all()
        truncated = len(rows) > self.settings.death_review_prior_aura_limit
        return list(reversed(rows[:self.settings.death_review_prior_aura_limit])), truncated

    def _read(self, recording, pull, snapshot, death):
        """完整读取后关联显式actor绑定；角色GUID和姓名不能替代绑定事实。"""
        prior, prior_truncated = self._prior(snapshot, death,
            pull.started_at_unix_ms + max(0, death["pullTimeMs"] - self.settings.death_review_window_ms))
        client_settings = self.settings.model_copy(update={"wcl_timeout_seconds": min(self.settings.wcl_timeout_seconds, self.settings.death_review_http_timeout_seconds)})
        client = self.client_factory(client_settings)
        try:
            document = read_window(client, self.settings, snapshot, death, pull.started_at_unix_ms,
                [stored_event(row.payload, pull.started_at_unix_ms) for row in prior], prior_truncated)
        except WclError as error:
            raise DomainError(502, str(error)) from None
        finally:
            client.close()
        if document["availability"] != "ready":
            return document
        bindings = {row["recordingId"]: row["actorId"] for row in snapshot.metadata_json["actorBindings"]}
        related = {event["sourceActorId"] for event in document["events"] if event["sourceIsPlayer"] and event["sourceActorId"] != death["targetActorId"]}
        views = self.session.scalars(select(Recording.id).where(Recording.team_id.in_(self.access.team_ids()),
            Recording.team_id == recording.team_id, Recording.team_pull_id == pull.id).order_by(Recording.id)).all()
        document["victimRecordingIds"] = [str(view) for view in views if bindings.get(str(view)) == death["targetActorId"]]
        document["relatedRecordingIds"] = [str(view) for view in views if bindings.get(str(view)) in related]
        return seal(document)

    def page(self, team_id, recording_id, event_id, cursor, limit, refresh=False):
        """游标固定一份内容快照，缓存过期回源后变化则拒绝混页。"""
        if not 1 <= limit <= self.settings.death_review_page_limit or refresh and cursor:
            raise DomainError(422, "死亡分页参数无效")
        recording, pull, snapshot, death = self._scope(team_id, recording_id, event_id)
        scope = [str(team_id), str(recording_id), str(snapshot.id), event_id]
        expected, offset = self.snapshots.decode(cursor, scope) if cursor else (None, 0)
        if not configured(self.settings):
            return {"revision": "", "sourceKind": "wcl", "availability": "notConfigured", "message": "WCL公共API尚未配置，不能补造死亡明细。",
                "death": death, "windowStartMs": max(0, death["pullTimeMs"] - self.settings.death_review_window_ms), "windowEndMs": death["pullTimeMs"],
                "events": [], "priorAuras": [], "total": 0, "observedCount": 0, "truncated": False, "priorAurasTruncated": False,
                "parseErrors": 0, "pairedRowsRemoved": 0, "victimRecordingIds": [], "relatedRecordingIds": [], "nextCursor": None, "hasMore": False}
        document = None if refresh else self.snapshots.cached(scope)
        if document is None:
            document = self._read(recording, pull, snapshot, death)
            if document["availability"] == "ready":
                self.snapshots.cached(scope, document)
        if expected and expected != document["revision"] or offset > document["total"]:
            raise DomainError(409, "死亡窗口内容已变化，请重新读取")
        following = offset + limit
        has_more = following < document["total"]
        return {**document, "events": document["events"][offset:following], "priorAuras": document["priorAuras"] if offset == 0 else [],
            "nextCursor": self.snapshots.encode(scope, document["revision"], following) if has_more else None, "hasMore": has_more}
