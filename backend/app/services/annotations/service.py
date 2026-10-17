"""团队录像画笔读取、权限边界和 PostgreSQL 原子 CAS 保存。"""

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.annotations import AnnotationSnapshot
from app.models.identity import TeamMember
from app.models.recordings import Recording, TeamPull
from app.schemas.annotations import PutAnnotations
from app.services.identity.access import AccessService, Principal
from app.utils.time_utils import cst_now


class AnnotationService:
    """编辑权来自当前账号与团队角色，不由请求字段或游戏角色推断。"""

    def __init__(self, session, principal: Principal, settings: Settings):
        """复用请求级会话、平台身份和集中限制。"""
        self.session, self.principal, self.settings = session, principal, settings
        self.access = AccessService(session, principal)

    def _scope(self, team_id: UUID, recording_id: UUID, writing: bool = False):
        """先团队再录像，写入期间锁当前成员关系，与撤权保持事务顺序。"""
        member = self.access.require_team(team_id)
        if writing:
            member = self.session.scalar(select(TeamMember).where(TeamMember.team_id == team_id,
                TeamMember.user_id == self.principal.user_id).with_for_update().execution_options(populate_existing=True))
            if member is None:
                raise DomainError(403, "当前账号不是该团队成员")
        row = self.session.execute(select(Recording, TeamPull)
            .join(TeamPull, TeamPull.id == Recording.team_pull_id)
            .where(Recording.team_id.in_(self.access.team_ids()))
            .where(Recording.team_id == team_id, Recording.id == recording_id)).first()
        if row is None:
            raise DomainError(404, "团队录像不存在")
        recording, pull = row
        can_edit = recording.user_id == self.principal.user_id or member.role in {"leader", "analyst"}
        if writing and not can_edit:
            raise DomainError(403, "仅录像上传者、团长或分析员可以编辑团队标记")
        return recording, pull, can_edit

    def get(self, team_id: UUID, recording_id: UUID) -> dict:
        """无快照只返回版本 0，不因读取创建空数据库记录。"""
        _, _, can_edit = self._scope(team_id, recording_id)
        snapshot = self.session.scalar(select(AnnotationSnapshot).where(AnnotationSnapshot.team_id.in_(self.access.team_ids()))
            .where(AnnotationSnapshot.team_id == team_id, AnnotationSnapshot.recording_id == recording_id))
        return {"version": snapshot.version if snapshot else 0, "items": snapshot.items if snapshot else [], "canEdit": can_edit}

    def _validate(self, request: PutAnnotations, duration: int):
        """数量、点数、文本和时间均有集中边界，超限不能截断后保存。"""
        config = self.settings
        if len(request.items) > config.annotation_max_items:
            raise DomainError(422, "团队标记数量超过限制")
        if sum(len(item.points) for item in request.items) > config.annotation_max_total_points:
            raise DomainError(422, "团队标记总点数超过限制")
        for item in request.items:
            if len(item.points) > config.annotation_max_points_per_item:
                raise DomainError(422, "单条画笔点数超过限制")
            if len(item.text) > config.annotation_max_text_chars:
                raise DomainError(422, "团队标记文字长度超过限制")
            if not config.annotation_min_width <= item.width <= config.annotation_max_width:
                raise DomainError(422, "画笔宽度超出允许范围")
            if not config.annotation_min_duration_ms <= item.duration_ms <= config.annotation_max_duration_ms:
                raise DomainError(422, "团队标记持续时间超出允许范围")
            if item.at_ms > duration:
                raise DomainError(422, "团队标记时间超出共同战斗范围")

    def put(self, team_id: UUID, recording_id: UUID, request: PutAnnotations) -> dict:
        """缺行先创建版本 0 再 CAS，同版本竞争最多一个成功，不用先读再写。"""
        _, pull, _ = self._scope(team_id, recording_id, writing=True)
        self._validate(request, pull.ended_at_unix_ms - pull.started_at_unix_ms)
        if request.expected_version == (1 << 32) - 1:
            raise DomainError(409, "团队标记版本已达到上限，未修改原快照")
        items = [item.model_dump(mode="json", by_alias=True) for item in request.items]
        now = cst_now()
        self.session.execute(insert(AnnotationSnapshot).values(team_id=team_id, recording_id=recording_id,
            version=0, items=[], updated_by=self.principal.user_id, updated_at=now)
            .on_conflict_do_nothing(index_elements=[AnnotationSnapshot.recording_id]))
        version = self.session.scalar(update(AnnotationSnapshot).where(AnnotationSnapshot.team_id == team_id,
            AnnotationSnapshot.recording_id == recording_id, AnnotationSnapshot.version == request.expected_version)
            .values(version=request.expected_version + 1, items=items, updated_by=self.principal.user_id, updated_at=now)
            .returning(AnnotationSnapshot.version))
        if version is None:
            self.session.rollback()
            raise DomainError(409, "团队标记已被其他成员修改，请重新读取后再保存")
        self.session.commit()
        return {"version": version, "items": items, "canEdit": True}
