"""受团队角色约束的 WCL 显式导入申请与幂等排队。"""

import hashlib
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import DomainError
from app.models.recordings import Recording, TeamPull
from app.models.wcl import WclImport
from app.schemas.wcl import ImportWcl
from app.services.wcl.adapter import configured
from app.services.wcl.query import WclQueryService
from app.utils.time_utils import cst_now


class WclImportService(WclQueryService):
    """只允许 leader／analyst 显式选 report/fight，不根据时间近似自动归组。"""

    def submit(self, team_id: UUID, pull_id: UUID, request: ImportWcl) -> dict:
        """单个 Pull 行锁序列化申请，完整旧快照继续可读。"""
        member = self.access.require_team(team_id)
        if member.role not in {"leader", "analyst"}:
            raise DomainError(403, "仅团长或分析员可以导入 WCL 报告")
        self.pull(team_id, pull_id, lock=True)
        if not configured(self.settings):
            raise DomainError(503, "WCL 公共 API 尚未配置服务端凭证；私有报告还需要独立用户 OAuth")
        self._key()
        data = request.model_dump(mode="json", by_alias=True, exclude={"refresh"})
        recording_ids = {binding.recording_id for binding in request.actor_bindings}
        if recording_ids:
            actual = set(self.session.scalars(select(Recording.id).where(Recording.team_id.in_(self.access.team_ids()))
                .where(Recording.team_id == team_id, Recording.team_pull_id == pull_id, Recording.id.in_(recording_ids))))
            if actual != recording_ids:
                raise DomainError(404, "角色绑定包含当前团队战斗以外的录像")
        conflict = self.session.scalar(select(TeamPull.id).where(TeamPull.team_id.in_(self.access.team_ids()))
            .where(TeamPull.team_id == team_id, TeamPull.id != pull_id,
                TeamPull.wcl_report_code == request.report_code, TeamPull.wcl_fight_id == request.fight_id))
        if conflict:
            raise DomainError(409, "该报告战斗已绑定本团队另一场 Pull，请先明确调整归属")
        digest = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        job = self.session.scalar(select(WclImport).where(WclImport.team_id == team_id,
            WclImport.team_pull_id == pull_id).with_for_update())
        if job and job.status in {"pending", "importing"}:
            if job.request_digest != digest:
                raise DomainError(409, "该战斗已有不同的 WCL 导入任务，请等待其完成")
            return self.status(team_id, pull_id)
        if job and job.status == "ready" and job.request_digest == digest and not request.refresh:
            return self.status(team_id, pull_id)
        if job is None:
            job = WclImport(team_id=team_id, team_pull_id=pull_id, requested_by=self.principal.user_id)
            self.session.add(job)
        job.request_json, job.request_digest, job.requested_by = data, digest, self.principal.user_id
        job.status, job.attempts, job.last_error = "pending", 0, None
        job.lease_token, job.lease_expires_at = None, None
        job.next_publish_at, job.published_at = cst_now(), None
        job.next_attempt_at = cst_now()
        try:
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            raise DomainError(409, "WCL 战斗绑定已被另一请求修改，请重新读取状态") from None
        return self.status(team_id, pull_id)
