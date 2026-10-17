"""真实 PostgreSQL 验证个人布局隔离、并发、撤权与可逆迁移。"""

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.api.dependencies import get_session
from app.core.errors import DomainError
from app.main import create_app
from app.models.identity import TeamMember
from app.models.replay_preferences import ReplayPreference
from app.schemas.replay_preferences import PutReplayPreferences, default_layout
from app.services.identity.access import Principal
from app.services.identity.provisioning import ProvisioningService
from app.services.preferences.replay import ReplayPreferenceService

pytestmark = pytest.mark.skipif(os.getenv("WOW_RUN_SERVICE_TESTS") != "1", reason="未显式提供隔离 PostgreSQL 环境")


@pytest.fixture
def preferences_pg(settings):
    """随机 schema 独立升级与清理，不接触正式业务库。"""
    settings = settings.model_copy(update={"database_url": SecretStr(os.environ["WOW_TEST_DATABASE_URL"])})
    admin = create_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    schema = "wow_preference_test_" + uuid4().hex
    isolated = None
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        isolated = create_engine(settings.database_url.get_secret_value(), hide_parameters=True,
            connect_args={"options": "-csearch_path=" + schema})
        config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        with isolated.connect() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
        factory = sessionmaker(bind=isolated, expire_on_commit=False)
        with factory() as session:
            provision = ProvisioningService(session, settings)
            users = {role: provision.create_user("偏好测试" + uuid4().hex) for role in ["leader", "member", "outside"]}
            team = provision.create_team("偏好测试团队", users["leader"].id)
            provision.add_member(team.id, users["member"].id, "member")
            second = provision.create_team("另一偏好团队", users["member"].id)
            tokens = {role: provision.issue_token(user.id, "preference-test")[1] for role, user in users.items()}
        app = create_app(settings)

        def scoped_session():
            """每个 HTTP 请求使用独立真实 PG 会话。"""
            with factory() as session:
                yield session

        app.dependency_overrides[get_session] = scoped_session
        headers = {role: {"Authorization": "Bearer " + token} for role, token in tokens.items()}
        with TestClient(app) as http:
            yield {"http": http, "factory": factory, "team": team.id, "second": second.id, "users": users,
                "headers": headers, "path": f"/api/v1/teams/{team.id}/preferences/replay", "engine": isolated, "config": config}
    finally:
        if isolated is not None:
            isolated.dispose()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True, if_exists=True))
        admin.dispose()


def personal_layout(name="关键时刻"):
    """生成有稳定轨道及真实格式覆盖键的完整布局。"""
    track = {"id": "custom-" + str(uuid4()), "name": name}
    return {**default_layout(), "customTimelineTracks": [track],
        "timelineTrackOverrides": {"player:642:castSuccess:Player-Test": track["id"]}, "timelineZoom": 1.5}


def test_private_preferences_http_isolation_and_validation(preferences_pg):
    """缺行只读、普通团员自写、跨账号团队隔离，非法输入不改旧快照。"""
    case = preferences_pg
    http, path, headers = case["http"], case["path"], case["headers"]
    assert http.get(path).status_code == 401
    assert http.get(path, headers=headers["outside"]).status_code == 403
    assert http.get(path, headers=headers["member"]).json() == {"version": 0, "document": default_layout()}
    with case["factory"]() as session:
        assert session.scalars(select(ReplayPreference)).all() == []
    body = {"expectedVersion": 9, "document": personal_layout("😀" * 32)}
    assert http.put(path, headers=headers["member"], json=body).status_code == 409
    with case["factory"]() as session:
        assert session.scalars(select(ReplayPreference)).all() == []
    body["expectedVersion"] = 0
    assert http.put(path, headers=headers["outside"], json=body).status_code == 403
    saved = http.put(path, headers=headers["member"], json=body)
    assert saved.status_code == 200 and saved.json() == {"version": 1, "document": body["document"]}
    assert http.get(path, headers=headers["leader"]).json()["document"] == default_layout()
    second_path = path.replace(str(case["team"]), str(case["second"]))
    assert http.get(second_path, headers=headers["member"]).json()["version"] == 0
    assert http.put(path, headers=headers["member"], json={**body, "userId": str(case["users"]["leader"].id)}).status_code == 422
    invalids = [{"timelineTrackHeight": True}, {"timelineTrackHeight": 30.0}, {"timelineTrackHeight": "30"},
        {"timelineIconPercent": 101}, {"timelineZoom": 1.25}, {"timelineZoom": True},
        {"timelineTrackOverrides": {"__proto__": "boss"}}, {"timelineTrackOverrides": {"boss:1:death:Player-X": "custom-missing"}},
        {"timelineTrackOverrides": {"boss:4294967296:death:Player-X": "boss"}},
        {"timelineTrackOverrides": {"boss:1:death:" + "x" * 160: "boss"}},
        {"timelineTrackOverrides": {f"team:{number}:castSuccess:Player-X": "team" for number in range(1025)}},
        {"customTimelineTracks": [{"id": "custom-" + str(uuid4()), "name": "轨道" + str(n)} for n in range(9)]},
        {"customTimelineTracks": [{"id": "custom-" + str(uuid4()), "name": name} for name in ["ABC", "abc"]]},
        {"events": []}]
    for name in ["", "空\x00值", "换\n行", " 首尾 ", "😀" * 33, "代理\ud800"]:
        invalids.append({"customTimelineTracks": [{"id": "custom-" + str(uuid4()), "name": name}]})
    for invalid in invalids:
        request = {"expectedVersion": 1, "document": {**body["document"], **invalid}}
        response = http.put(path, headers={**headers["member"], "Content-Type": "application/json"}, content=json.dumps(request))
        assert response.status_code == 422, invalid.keys()
    raw = json.dumps({"expectedVersion": 1, "document": {**body["document"], "timelineZoom": float("nan")}})
    assert http.put(path, headers={**headers["member"], "Content-Type": "application/json"}, content=raw).status_code == 422
    assert http.get(path, headers=headers["member"]).json() == saved.json()
    with case["factory"]() as session:
        row = session.get(ReplayPreference, (case["team"], case["users"]["member"].id))
        assert row.updated_at.utcoffset() is not None
        row.version = (1 << 32) - 1
        session.commit()
    body["expectedVersion"] = (1 << 32) - 1
    assert http.put(path, headers=headers["member"], json=body).status_code == 409


@pytest.mark.parametrize("expected", [0, 1])
def test_private_preferences_independent_connections_cas(preferences_pg, expected):
    """同一账号两个连接竞争初建或已有行，同版本只能一个成功。"""
    case = preferences_pg
    if expected:
        assert case["http"].put(case["path"], headers=case["headers"]["member"],
            json={"expectedVersion": 0, "document": default_layout()}).status_code == 200
    barrier = threading.Barrier(2)

    def save(label):
        """连接与事务独立，在进入服务之前同步竞争起点。"""
        with case["factory"]() as session:
            service = ReplayPreferenceService(session, Principal(case["users"]["member"].id, label))
            request = PutReplayPreferences(expectedVersion=expected, document=personal_layout(label))
            barrier.wait(timeout=5)
            try:
                return 200, service.put(case["team"], request)
            except DomainError as error:
                return error.status_code, None

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(save, label) for label in ["页面甲", "页面乙"]]
        results = [future.result(timeout=15) for future in futures]
    assert sorted(status for status, _ in results) == [200, 409]
    winner = next(value for status, value in results if status == 200)
    assert case["http"].get(case["path"], headers=case["headers"]["member"]).json() == winner


def test_private_preferences_revocation_wins_pending_save(preferences_pg):
    """撤权持有成员行锁时等待中的保存必须失败，已保存偏好被级联清除。"""
    case = preferences_pg
    body = {"expectedVersion": 0, "document": personal_layout()}
    assert case["http"].put(case["path"], headers=case["headers"]["member"], json=body).status_code == 200
    entered = threading.Event()
    user = case["users"]["member"]

    def pending_save():
        """确认读取到原成员关系后再等待撤权锁，复现真实竞态。"""
        with case["factory"]() as session:
            service = ReplayPreferenceService(session, Principal(user.id, "成员"))
            original = service.access.require_team

            def observed(team):
                """只同步测试时序，不替代 PG 权限或锁。"""
                value = original(team)
                entered.set()
                return value

            service.access.require_team = observed
            try:
                service.put(case["team"], PutReplayPreferences(expectedVersion=1, document=personal_layout("不能保存")))
                return 200
            except DomainError as error:
                return error.status_code

    with ThreadPoolExecutor(max_workers=1) as executor:
        with case["factory"]() as revocation:
            member = revocation.scalar(select(TeamMember).where(TeamMember.team_id == case["team"], TeamMember.user_id == user.id).with_for_update())
            future = executor.submit(pending_save)
            assert entered.wait(timeout=5)
            revocation.delete(member)
            revocation.commit()
        assert future.result(timeout=10) == 403
    assert case["http"].get(case["path"], headers=case["headers"]["member"]).status_code == 403
    with case["factory"]() as session:
        assert session.get(ReplayPreference, (case["team"], user.id)) is None


def test_private_preferences_migration_downgrade_and_reupgrade(preferences_pg):
    """回退只移除新表，成员关系及其他表保持，重升后默认无行。"""
    case = preferences_pg
    assert case["http"].put(case["path"], headers=case["headers"]["member"],
        json={"expectedVersion": 0, "document": personal_layout()}).status_code == 200
    with case["engine"].connect() as connection:
        case["config"].attributes["connection"] = connection
        before = set(inspect(connection).get_table_names())
        command.downgrade(case["config"], "20261017_04")
        connection.commit()
        assert set(inspect(connection).get_table_names()) == before - {"replay_preferences"}
        command.upgrade(case["config"], "head")
        connection.commit()
        assert set(inspect(connection).get_table_names()) == before
    assert case["http"].get(case["path"], headers=case["headers"]["member"]).json() == {"version": 0, "document": default_layout()}


def test_private_preferences_maximum_layout_roundtrip(preferences_pg):
    """八轨及1024条规则完整往返不截断，重复编号不能进入下一版。"""
    case = preferences_pg
    tracks = [{"id": "custom-" + str(uuid4()), "name": "个人轨道" + str(index)} for index in range(8)]
    rules = {f"team:{index}:castSuccess:Player-Test": tracks[index % 8]["id"] for index in range(1023)}
    prefix = "boss:4294967295:castStart:"
    rules[prefix + "x" * (160 - len(prefix))] = "boss"
    document = {"customTimelineTracks": tracks, "timelineTrackOverrides": rules,
        "timelineTrackHeight": 20, "timelineIconPercent": 50, "timelineZoom": 4}
    saved = case["http"].put(case["path"], headers=case["headers"]["member"], json={"expectedVersion": 0, "document": document})
    assert saved.status_code == 200 and saved.json() == {"version": 1, "document": document}
    assert case["http"].get(case["path"], headers=case["headers"]["member"]).json() == saved.json()
    duplicate = {**document, "customTimelineTracks": [tracks[0], {**tracks[0], "name": "另一个名称"}]}
    assert case["http"].put(case["path"], headers=case["headers"]["member"], json={"expectedVersion": 1, "document": duplicate}).status_code == 422
    assert case["http"].get(case["path"], headers=case["headers"]["member"]).json() == saved.json()
