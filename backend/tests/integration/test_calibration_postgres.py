"""真实PostgreSQL验证团队校准的身份、双版本CAS及产物失效。"""

import copy
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.api.dependencies import get_session
from app.main import create_app
from app.models.identity import TeamMember
from app.models.recordings import Recording
from app.services.identity.provisioning import ProvisioningService

pytestmark = pytest.mark.skipif(os.getenv("WOW_RUN_SERVICE_TESTS") != "1", reason="需要显式隔离PostgreSQL")


@pytest.fixture
def calibration_pg(settings, registration):
    """每项独立schema，每个HTTP请求独立连接，只清理本次命名空间。"""
    settings = settings.model_copy(update={"database_url": SecretStr(os.environ["WOW_TEST_DATABASE_URL"])})
    schema = "wow_calibration_" + uuid4().hex
    admin = create_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    engine = None
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        engine = create_engine(settings.database_url.get_secret_value(), hide_parameters=True,
            connect_args={"options": "-csearch_path=" + schema})
        with engine.connect() as connection:
            config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        with factory() as session:
            provision = ProvisioningService(session, settings)
            users = {role: provision.create_user("对齐测试" + uuid4().hex) for role in ["leader", "owner", "analyst", "reader", "outside"]}
            team = provision.create_team("对齐测试团队", users["leader"].id)
            for role in ["owner", "analyst", "reader"]:
                provision.add_member(team.id, users[role].id, "analyst" if role == "analyst" else "member")
            headers = {role: {"Authorization": "Bearer " + provision.issue_token(user.id, "calibration-test")[1]} for role, user in users.items()}
        app = create_app(settings)

        def scoped_session():
            """请求生命周期内的提交／回滚由真实SQLAlchemy会话承担。"""
            with factory() as session:
                yield session

        app.dependency_overrides[get_session] = scoped_session
        with TestClient(app) as http:
            data = registration.model_dump(mode="json", by_alias=True); data["teamId"] = str(team.id)
            registered = http.post("/api/v1/recordings", json=data, headers=headers["owner"])
            assert registered.status_code == 201
            recording_id, version = UUID(registered.json()["recordingId"]), uuid4()
            with factory() as session:
                recording = session.get(Recording, recording_id)
                recording.status, recording.playback_version = "ready", version
                recording.playback_key = "test-only/index.m3u8"
                original, digest = copy.deepcopy(recording.manifest), recording.request_digest
                session.commit()
            yield {"http": http, "factory": factory, "headers": headers, "users": users, "team": team.id,
                "recording": recording_id, "version": version, "original": original, "digest": digest, "request": data,
                "path": f"/api/v1/teams/{team.id}/recordings/{recording_id}/calibration"}
    finally:
        if engine is not None:
            engine.dispose()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True, if_exists=True))
        admin.dispose()


def test_shared_calibration_permissions_catalog_and_media_version(calibration_pg):
    """授权值进入目录，原映射及幂等身份不变，发布变化后旧页面不能覆盖。"""
    c = calibration_pg; http, h, path = c["http"], c["headers"], c["path"]
    initial = http.get(path, headers=h["reader"]).json()
    assert initial["version"] == 0 and not initial["canEdit"] and not initial["active"]
    assert http.get(path, headers=h["outside"]).status_code == 403
    request = {"expectedVersion": 0, "playbackVersion": str(c["version"]), "offsetMs": 500}
    assert http.put(path, json=request, headers=h["reader"]).status_code == 403
    assert http.put(path, json={**request, "canEdit": True}, headers=h["owner"]).status_code == 422
    saved = http.put(path, json=request, headers=h["owner"])
    assert saved.status_code == 200, saved.text
    assert saved.json()["version"] == 1 and saved.json()["active"] and saved.json()["offsetMs"] == 500
    assert len(saved.json()["updatedAt"]) == 19
    read = http.get(path, headers=h["reader"]).json()
    assert read["offsetMs"] == 500 and not read["canEdit"]
    catalog = http.get(f"/api/v1/teams/{c['team']}/recordings", headers=h["reader"]).json()
    assert catalog[0]["sharedCalibration"] == read
    assert catalog[0]["videoZeroMs"] == c["original"]["videoZeroMs"]
    with c["factory"]() as session:
        recording = session.get(Recording, c["recording"])
        assert {key: value for key, value in recording.manifest.items() if key != "sharedCalibration"} == c["original"]
        assert recording.request_digest == c["digest"]
        recording.playback_version = uuid4(); new_version = recording.playback_version
        session.commit()
    stale = http.get(path, headers=h["leader"]).json()
    assert stale["stale"] and not stale["active"] and stale["offsetMs"] == 500
    assert http.put(path, json={**request, "expectedVersion": 1}, headers=h["leader"]).status_code == 409
    accepted = http.put(path, json={**request, "expectedVersion": 1, "playbackVersion": str(new_version), "offsetMs": -250}, headers=h["analyst"])
    assert accepted.status_code == 200 and accepted.json()["version"] == 2 and accepted.json()["active"]
    for offset in [300001, 99999]:
        assert http.put(path, json={"expectedVersion": 2, "playbackVersion": str(new_version), "offsetMs": offset}, headers=h["owner"]).status_code == 422
    with c["factory"]() as session:
        session.get(Recording, c["recording"]).status = "processing"; session.commit()
    pending = http.get(path, headers=h["leader"]).json()
    assert not pending["active"] and pending["stale"]
    assert http.put(path, json={"expectedVersion": 2, "playbackVersion": str(new_version), "offsetMs": 0}, headers=h["owner"]).status_code == 409


def test_two_editors_compete_and_revocation_prevents_further_writes(calibration_pg):
    """不同用户并发保存同一版本只一个成功，真实独立连接及当前成员权限生效。"""
    c = calibration_pg; gate = Barrier(2)

    def submit(role):
        """同步发起两个独立HTTP请求，不用线程内顺序调用冒充竞争。"""
        gate.wait(timeout=10)
        return c["http"].put(c["path"], headers=c["headers"][role], json={"expectedVersion": 0,
            "playbackVersion": str(c["version"]), "offsetMs": 500 if role == "leader" else -250})

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(submit, ["leader", "analyst"]))
    assert sorted(response.status_code for response in responses) == [200, 409]
    published = c["http"].get(c["path"], headers=c["headers"]["reader"]).json()
    assert published["version"] == 1 and published["offsetMs"] == next(response.json()["offsetMs"] for response in responses if response.status_code == 200)
    with c["factory"]() as session:
        member = session.get(TeamMember, (c["team"], c["users"]["analyst"].id)); member.role = "member"; session.commit()
    assert not c["http"].get(c["path"], headers=c["headers"]["analyst"]).json()["canEdit"]
    request = {"expectedVersion": 1, "playbackVersion": str(c["version"]), "offsetMs": 0}
    assert c["http"].put(c["path"], json=request, headers=c["headers"]["analyst"]).status_code == 403
    with c["factory"]() as session:
        session.delete(session.get(TeamMember, (c["team"], c["users"]["owner"].id))); session.commit()
    assert c["http"].get(c["path"], headers=c["headers"]["owner"]).status_code == 403
    assert c["http"].put(c["path"], json=request, headers=c["headers"]["owner"]).status_code == 403
    assert c["http"].get(c["path"], headers=c["headers"]["leader"]).json()["version"] == 1
