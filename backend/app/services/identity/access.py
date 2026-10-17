"""令牌认证和先于资源筛选的团队范围校验。"""

import hashlib
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.identity import ApiToken, Team, TeamMember, User
from app.utils.time_utils import cst_now, normalize_to_cst


@dataclass(frozen=True)
class Principal:
    """只由成功验证的平台令牌建立，忽略请求自报用户身份。"""

    user_id: UUID
    display_name: str


def token_digest(raw: str) -> str:
    """随机令牌不包含密码语义，只保留不可恢复的固定长度摘要。"""
    return hashlib.sha256(raw.encode()).hexdigest()


class AccessService:
    """保存请求会话与当前身份，统一应用团队权限范围。"""

    def __init__(self, session: Session, principal: Principal | None = None):
        """匿名实例仅用于验证令牌，领域查询必须传入身份。"""
        self.session = session
        self.principal = principal

    def authenticate(self, raw: str, settings: Settings) -> Principal:
        """拒绝失效、撤销、过期或停用账号的令牌。"""
        if not raw.startswith(settings.api_token_prefix) or not 40 <= len(raw) <= 128:
            raise DomainError(401, "访问令牌无效或已失效")
        row = self.session.execute(select(ApiToken, User).join(User, User.id == ApiToken.user_id)
                                   .where(ApiToken.token_digest == token_digest(raw))).first()
        if not row or row[0].revoked_at or normalize_to_cst(row[0].expires_at) <= cst_now() or not row[1].active:
            raise DomainError(401, "访问令牌无效或已失效")
        return Principal(row[1].id, row[1].display_name)

    def team_ids(self):
        """返回当前用户的参数化团队子查询，后续再添加资源 ID 条件。"""
        if not self.principal:
            raise DomainError(401, "请先登录")
        return select(TeamMember.team_id).where(TeamMember.user_id == self.principal.user_id)

    def require_team(self, team_id: UUID) -> TeamMember:
        """角色或报告身份都不能扩大该成员关系。"""
        if not self.principal:
            raise DomainError(401, "请先登录")
        member = self.session.scalar(select(TeamMember).where(TeamMember.user_id == self.principal.user_id,
                                                              TeamMember.team_id == team_id))
        if not member:
            raise DomainError(403, "当前账号不是该团队成员")
        return member

    def profile(self) -> dict:
        """返回当前用户明确加入的团队与实际角色。"""
        rows = self.session.execute(select(Team, TeamMember.role).join(TeamMember, Team.id == TeamMember.team_id)
                                    .where(TeamMember.user_id == self.principal.user_id).order_by(Team.created_at)).all()
        return {"userId": self.principal.user_id, "displayName": self.principal.display_name,
                "teams": [{"teamId": team.id, "name": team.name, "role": role} for team, role in rows]}
