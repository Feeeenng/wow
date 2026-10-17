"""个人回放偏好的账号隔离、成员关系锁与 PostgreSQL CAS。"""

from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert

from app.core.errors import DomainError
from app.core.replay_preferences import VERSION_MAX
from app.models.identity import TeamMember
from app.models.replay_preferences import ReplayPreference
from app.schemas.replay_preferences import PutReplayPreferences, default_layout
from app.services.identity.access import AccessService, Principal
from app.utils.time_utils import cst_now


class ReplayPreferenceService:
    """所有成员仅管理本人布局，团长也不能代读或代写他人。"""

    def __init__(self, session, principal: Principal):
        """用户身份只能来自服务端认证上下文。"""
        self.session, self.principal = session, principal
        self.access = AccessService(session, principal)

    def get(self, team_id: UUID) -> dict:
        """不存在时返回版本零，读取不创建数据库记录。"""
        self.access.require_team(team_id)
        row = self.session.get(ReplayPreference, (team_id, self.principal.user_id))
        return {"version": row.version if row else 0, "document": row.document if row else default_layout()}

    def put(self, team_id: UUID, request: PutReplayPreferences) -> dict:
        """写入与撤权按成员行锁排序，同版本竞争只允许一个成功。"""
        self.access.require_team(team_id)
        member = self.session.scalar(select(TeamMember).where(TeamMember.team_id == team_id,
            TeamMember.user_id == self.principal.user_id).with_for_update().execution_options(populate_existing=True))
        if member is None:
            raise DomainError(403, "当前账号不是该团队成员")
        if request.expected_version == VERSION_MAX:
            raise DomainError(409, "个人布局版本已达到上限，原布局未修改")
        document = request.document.model_dump(mode="json", by_alias=True)
        now = cst_now()
        self.session.execute(insert(ReplayPreference).values(team_id=team_id, user_id=self.principal.user_id,
            version=0, document=default_layout(), updated_at=now).on_conflict_do_nothing(
                index_elements=[ReplayPreference.team_id, ReplayPreference.user_id]))
        version = self.session.scalar(update(ReplayPreference).where(ReplayPreference.team_id == team_id,
            ReplayPreference.user_id == self.principal.user_id, ReplayPreference.version == request.expected_version)
            .values(version=request.expected_version + 1, document=document, updated_at=now).returning(ReplayPreference.version))
        if version is None:
            self.session.rollback()
            raise DomainError(409, "个人布局已在其他页面修改，请读取最新布局后复核")
        self.session.commit()
        return {"version": version, "document": document}
