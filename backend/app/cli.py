"""显式运维入口：账号／团队配置及私有存储初始化。"""

import argparse
import json
from uuid import UUID

from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.core.errors import DomainError
from app.db.session import session_factory
from app.services.identity.provisioning import ProvisioningService
from app.services.uploads.storage import S3Storage
from app.utils.time_utils import serialize_cst_datetime


def main():
    """明文令牌只写入执行者终端，不自动生成账户、迁移或记录日志。"""
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    user = commands.add_parser("create-user", help="创建平台账号")
    user.add_argument("--name", required=True)
    team = commands.add_parser("create-team", help="创建团队并明确团长账号")
    team.add_argument("--name", required=True)
    team.add_argument("--owner-user-id", type=UUID, required=True)
    member = commands.add_parser("add-member", help="显式授予指定团队角色")
    member.add_argument("--team-id", type=UUID, required=True)
    member.add_argument("--user-id", type=UUID, required=True)
    member.add_argument("--role", choices=["leader", "analyst", "member"], required=True)
    token = commands.add_parser("issue-token", help="签发随机访问令牌，仅显示一次")
    token.add_argument("--user-id", type=UUID, required=True)
    token.add_argument("--label", required=True)
    token.add_argument("--days", type=int)
    revoke = commands.add_parser("revoke-token", help="撤销指定令牌")
    revoke.add_argument("--token-id", type=UUID, required=True)
    commands.add_parser("storage-init", help="显式初始化或核对配置中的私有桶")
    args = parser.parse_args()
    settings = get_settings()
    try:
        if args.command == "storage-init":
            created = S3Storage(settings).initialize_private_bucket()
            print(json.dumps({"created": created, "privateBucketVerified": True}))
            return
        with session_factory()() as session:
            service = ProvisioningService(session, settings)
            if args.command == "create-user":
                user = service.create_user(args.name)
                output = {"userId": str(user.id), "displayName": user.display_name}
            elif args.command == "create-team":
                team = service.create_team(args.name, args.owner_user_id)
                output = {"teamId": str(team.id), "name": team.name}
            elif args.command == "add-member":
                service.add_member(args.team_id, args.user_id, args.role)
                output = {"teamId": str(args.team_id), "userId": str(args.user_id), "role": args.role}
            elif args.command == "issue-token":
                token, raw = service.issue_token(args.user_id, args.label, args.days)
                output = {"tokenId": str(token.id), "expiresAt": serialize_cst_datetime(token.expires_at), "accessToken": raw}
            else:
                service.revoke_token(args.token_id)
                output = {"revoked": True}
            print(json.dumps(output, ensure_ascii=False))
    except DomainError as error:
        parser.exit(1, error.detail + "\n")
    except SQLAlchemyError:
        parser.exit(1, "数据库不可用或迁移未完成\n")


if __name__ == "__main__":
    main()
