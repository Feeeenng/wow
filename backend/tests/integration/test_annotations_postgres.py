"""真实 PostgreSQL 画笔权限、边界和独立连接的并发 CAS。"""

import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.api.dependencies import get_session
from app.core.errors import DomainError
from app.main import create_app
from app.models.annotations import AnnotationSnapshot
from app.models.identity import TeamMember
from app.schemas.annotations import PutAnnotations
from app.services.annotations.service import AnnotationService
from app.services.identity.access import Principal
from app.services.identity.provisioning import ProvisioningService

pytestmark = pytest.mark.skipif(os.getenv("WOW_RUN_SERVICE_TESTS") != "1", reason="未显式提供隔离 PostgreSQL 环境")


def annotation(label="备注") -> dict:
    """生成绘制次序可辨认的测试箭头，不涉及真实用户录像。"""
    return {"id": str(uuid4()), "kind": "arrow", "points": [{"x": 0.1, "y": 0.2}, {"x": 0.8, "y": 0.9}],
        "color": "#ff6600", "width": 2, "text": label, "atMs": 1000, "durationMs": 5000}


@pytest.fixture
def annotations_pg(settings, registration):
    """每个用例使用随机 schema 与真实独立会话，结束只清理自身数据。"""
    settings = settings.model_copy(update={"database_url": SecretStr(os.environ["WOW_TEST_DATABASE_URL"])})
    schema = "wow_annotation_test_" + uuid4().hex
    admin = create_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    isolated = None
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        isolated = create_engine(settings.database_url.get_secret_value(), hide_parameters=True,
            connect_args={"options": "-csearch_path=" + schema})
        with isolated.connect() as connection:
            config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
        factory = sessionmaker(bind=isolated, expire_on_commit=False)
        roles = ["leader", "owner", "analyst", "reader", "outside"]
        with factory() as session:
            provision = ProvisioningService(session, settings)
            users = {role: provision.create_user("画笔测试" + uuid4().hex) for role in roles}
            team = provision.create_team("画笔测试团队", users["leader"].id)
            for role in ["owner", "analyst", "reader"]:
                provision.add_member(team.id, users[role].id, "analyst" if role == "analyst" else "member")
            tokens = {role: provision.issue_token(user.id, "annotation-test")[1] for role, user in users.items()}
        app = create_app(settings)

        def scoped_session():
            """每个 HTTP 请求获取自己的 PG 连接，绝不使用 SQLite 替身。"""
            with factory() as session:
                yield session

        app.dependency_overrides[get_session] = scoped_session
        headers = {role: {"Authorization": "Bearer " + token} for role, token in tokens.items()}
        with TestClient(app) as http:
            data = registration.model_dump(mode="json", by_alias=True)
            data["teamId"] = str(team.id)
            registered = http.post("/api/v1/recordings", json=data, headers=headers["owner"])
            assert registered.status_code == 201, registered.text
            task = registered.json()
            path = f"/api/v1/teams/{team.id}/recordings/{task['recordingId']}/annotations"
            yield {"http": http, "factory": factory, "settings": settings, "team": team.id,
                "recording": UUID(task["recordingId"]), "users": users, "headers": headers, "path": path, "app": app}
    finally:
        if isolated is not None:
            isolated.dispose()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True, if_exists=True))
        admin.dispose()


def test_annotations_http_permissions_finite_limits_and_revocation(annotations_pg):
    """成员只读、上传者／管理者写；边界或撤权不能修改已发布快照。"""
    case = annotations_pg
    http, headers, path = case["http"], case["headers"], case["path"]
    initial = http.get(path, headers=headers["reader"])
    assert initial.json() == {"version": 0, "items": [], "canEdit": False}
    with case["factory"]() as session:
        assert session.scalars(select(AnnotationSnapshot)).all() == []
    assert http.put(path, json={"expectedVersion": 1, "items": []}, headers=headers["leader"]).status_code == 409
    with case["factory"]() as session:
        assert session.scalars(select(AnnotationSnapshot)).all() == []
    value = annotation()
    body = {"expectedVersion": 0, "items": [value]}
    assert http.put(path, json=body, headers=headers["reader"]).status_code == 403
    assert http.get(path, headers=headers["outside"]).status_code == 403
    assert http.put(path, json=body, headers=headers["outside"]).status_code == 403
    assert http.get(path.replace(str(case["recording"]), str(uuid4())), headers=headers["owner"]).status_code == 404
    saved = http.put(path, json=body, headers=headers["owner"])
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 1 and saved.json()["items"][0]["color"] == "#FF6600"
    assert http.put(path, json=body, headers=headers["leader"]).status_code == 409
    body["expectedVersion"] = 1
    assert http.put(path, json=body, headers=headers["analyst"]).json()["version"] == 2
    # atMs 可落在共同战斗终点；duration 不伪装为视频绝对时间。
    body["expectedVersion"] = 2
    body["items"][0]["atMs"] = 5000
    assert http.put(path, json=body, headers=headers["leader"]).json()["version"] == 3
    stable = http.get(path, headers=headers["reader"]).json()
    for override in [{"width": 13}, {"text": "字" * 501}, {"atMs": 5001}, {"durationMs": 60001},
                     {"points": [{"x": 0, "y": 0}] * 513}, {"svg": "<svg/>"}]:
        invalid = {"expectedVersion": 3, "items": [{**value, **override}]}
        assert http.put(path, json=invalid, headers=headers["owner"]).status_code == 422
    too_many = {"expectedVersion": 3, "items": [annotation() for _ in range(201)]}
    assert http.put(path, json=too_many, headers=headers["leader"]).status_code == 422
    pen = {**annotation(), "kind": "pen", "points": [{"x": 0.1, "y": 0.2}] * 513}
    assert http.put(path, json={"expectedVersion": 3, "items": [pen]}, headers=headers["owner"]).status_code == 422
    dense = [{**annotation(), "kind": "pen", "points": [{"x": 0.1, "y": 0.2}] * 300} for _ in range(80)]
    assert http.put(path, json={"expectedVersion": 3, "items": dense}, headers=headers["leader"]).status_code == 422
    # 使用原始 JSON 发送非标准非有限常量，验证错误响应不会再次编码 NaN 而变成 500。
    raw = '{"expectedVersion":3,"items":[{"id":"' + str(uuid4()) + '","kind":"pen","points":[{"x":NaN,"y":0},{"x":1,"y":1}],"color":"#FFFFFF","width":1,"atMs":0,"durationMs":1}]}'
    nonfinite = http.put(path, content=raw, headers={**headers["owner"], "Content-Type": "application/json"})
    assert nonfinite.status_code == 422 and "NaN" not in nonfinite.text
    assert http.get(path, headers=headers["reader"]).json() == stable
    preflight = http.options(path, headers={"Origin": "http://tauri.localhost", "Access-Control-Request-Method": "PUT"})
    assert preflight.status_code == 200 and "PUT" in preflight.headers["access-control-allow-methods"]
    with case["factory"]() as session:
        session.delete(session.get(TeamMember, (case["team"], case["users"]["owner"].id)))
        session.commit()
    assert http.get(path, headers=headers["owner"]).status_code == 403
    assert http.put(path, json={"expectedVersion": 3, "items": []}, headers=headers["owner"]).status_code == 403
    assert http.get(path, headers=headers["leader"]).json()["version"] == 3
    with case["factory"]() as session:
        session.get(AnnotationSnapshot, case["recording"]).version = (1 << 32) - 1
        session.commit()
    assert http.put(path, json={"expectedVersion": (1 << 32) - 1, "items": []}, headers=headers["leader"]).status_code == 409
    assert http.get(path, headers=headers["reader"]).json()["items"] == stable["items"]


@pytest.mark.parametrize("expected", [0, 1])
def test_annotations_concurrent_first_and_existing_cas_one_winner(annotations_pg, expected):
    """两个不同编辑者及独立 PG 连接竞争同版本，初建与更新均只有一个成功。"""
    case = annotations_pg
    if expected == 1:
        response = case["http"].put(case["path"], headers=case["headers"]["owner"], json={"expectedVersion": 0, "items": []})
        assert response.status_code == 200
    barrier = threading.Barrier(2)

    def save(role):
        """不同成员行锁不会把竞争隐式串行成同一编辑者流程。"""
        principal = Principal(case["users"][role].id, role)
        with case["factory"]() as session:
            service = AnnotationService(session, principal, case["settings"])
            request = PutAnnotations(expectedVersion=expected, items=[annotation(role)])
            barrier.wait(timeout=5)
            try:
                return 200, service.put(case["team"], case["recording"], request)
            except DomainError as error:
                return error.status_code, None

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(save, role) for role in ["owner", "analyst"]]
        results = [future.result(timeout=15) for future in futures]
    assert sorted(status for status, _ in results) == [200, 409]
    winner = next(value for status, value in results if status == 200)
    final = case["http"].get(case["path"], headers=case["headers"]["reader"]).json()
    assert final["version"] == expected + 1 and final["items"] == winner["items"]


def test_annotations_nul_is_input_error_and_plain_text_layout_roundtrips(annotations_pg):
    """NUL 应在入库前返回 422，Tab／Windows 换行及字面标记应正常保存。"""
    case = annotations_pg
    value = annotation("前缀\x00后缀")
    path, headers, http = case["path"], case["headers"]["owner"], case["http"]
    rejected = http.put(path, json={"expectedVersion": 0, "items": [value]}, headers=headers)
    assert rejected.status_code == 422, "NUL 必须是输入校验失败，不能成为数据库 503"
    assert http.get(path, headers=headers).json()["version"] == 0
    value.update(kind="text", points=value["points"][:1], text="第一行\t备注\r\n第二行 <b>字面内容</b>")
    accepted = http.put(path, json={"expectedVersion": 0, "items": [value]}, headers=headers)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["items"][0]["text"] == value["text"]
    assert http.get(path, headers=headers).json()["items"][0]["text"] == value["text"]
