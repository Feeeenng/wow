"""仅供明确执行的运维 CLI 创建账号、团队及令牌。"""

import secrets
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainError
from app.models.identity import ApiToken, Team, TeamMember, User
from app.services.identity.access import token_digest
from app.utils.time_utils import cst_now


class ProvisioningService:
    """此服务不挂匿名 HTTP 接口，所有授权由操作者显式指定。"""

    def __init__(self, session: Session, settings: Settings):
        """保留运维操作会话及令牌策略。"""
        self.session, self.settings = session, settings

    def create_user(self, name: str) -> User:
        """创建启用账号，不附带团队、管理员或可猜测密码。"""
        name = name.strip()
        if not 1 <= len(name) <= 128 or self.session.scalar(select(User.id).where(User.display_name == name)):
            raise DomainError(409, "账号名称无效或已存在")
        user = User(display_name=name)
        self.session.add(user)
        self.session.commit()
        return user

    def create_team(self, name: str, owner_id: UUID) -> Team:
        """只有明确指定的已有账号获得该团队团长角色。"""
        self._user(owner_id)
        if not 1 <= len(name.strip()) <= 128:
            raise DomainError(422, "团队名称无效")
        team = Team(name=name.strip())
        self.session.add(team)
        self.session.flush()
        self.session.add(TeamMember(team_id=team.id, user_id=owner_id, role="leader"))
        self.session.commit()
        return team

    def add_member(self, team_id: UUID, user_id: UUID, role: str) -> None:
        """仅显式修改指定团队的成员，不从游戏角色名推导权限。"""
        self._user(user_id)
        if role not in {"leader", "analyst", "member"} or not self.session.get(Team, team_id):
            raise DomainError(422, "团队或成员角色无效")
        member = self.session.get(TeamMember, (team_id, user_id))
        if member:
            member.role = role
        else:
            self.session.add(TeamMember(team_id=team_id, user_id=user_id, role=role))
        self.session.commit()

    def issue_token(self, user_id: UUID, label: str, days: int | None = None) -> tuple[ApiToken, str]:
        """明文只返回给此次 CLI 执行者，调用方不得写入日志或仓库。"""
        self._user(user_id)
        days = days if days is not None else self.settings.api_token_days
        if not 1 <= days <= 90 or not 1 <= len(label.strip()) <= 128:
            raise DomainError(422, "令牌名称或有效期无效")
        raw = self.settings.api_token_prefix + secrets.token_urlsafe(32)
        token = ApiToken(user_id=user_id, label=label.strip(), token_digest=token_digest(raw),
                         expires_at=cst_now() + timedelta(days=days))
        self.session.add(token)
        self.session.commit()
        return token, raw

    def revoke_token(self, token_id: UUID) -> None:
        """撤销只影响后续请求，不删除已有上传和审计归属。"""
        token = self.session.get(ApiToken, token_id)
        if not token:
            raise DomainError(404, "访问令牌不存在")
        token.revoked_at = cst_now()
        self.session.commit()

    def _user(self, user_id: UUID) -> User:
        """运维输入必须对应启用的平台账号。"""
        user = self.session.get(User, user_id)
        if not user or not user.active:
            raise DomainError(404, "账号不存在或已停用")
        return user
