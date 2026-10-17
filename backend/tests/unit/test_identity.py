"""认证撤销、过期与团队范围边界。"""

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql

from app.core.errors import DomainError
from app.services.identity.access import AccessService, Principal, token_digest
from app.utils.time_utils import cst_now


def test_token_expiry_revocation_and_inactive_accounts(settings):
    """使用模拟查询结果覆盖认证分支，不接触真实账号或令牌。"""
    session = MagicMock()
    user = SimpleNamespace(id=uuid4(), display_name="测试", active=True)
    token = SimpleNamespace(revoked_at=None, expires_at=cst_now() + timedelta(days=1))
    session.execute.return_value.first.return_value = (token, user)
    service = AccessService(session)
    raw = "wow_" + "x" * 43
    assert service.authenticate(raw, settings).user_id == user.id
    statement = session.execute.call_args[0][0]
    assert token_digest(raw) in statement.compile().params.values()
    assert raw not in statement.compile().params.values()
    for field, value in [("revoked_at", cst_now()), ("expires_at", cst_now() - timedelta(seconds=1))]:
        old = getattr(token, field)
        setattr(token, field, value)
        with pytest.raises(DomainError) as error:
            service.authenticate(raw, settings)
        assert error.value.status_code == 401
        setattr(token, field, old)
    user.active = False
    with pytest.raises(DomainError):
        service.authenticate(raw, settings)


def test_membership_is_required_and_scope_is_parameterized():
    """角色 GUID 或团队自报值不能替代数据库成员关系。"""
    session = MagicMock()
    session.scalar.return_value = None
    principal = Principal(uuid4(), "测试")
    service = AccessService(session, principal)
    with pytest.raises(DomainError) as error:
        service.require_team(uuid4())
    assert error.value.status_code == 403
    compiled = service.team_ids().compile(dialect=postgresql.dialect())
    assert principal.user_id in compiled.params.values()
    assert "team_members.user_id" in str(compiled)
