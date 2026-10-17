"""真实 PostgreSQL 加本地 HTTP WCL 协议服务；不访问线上报告。"""

import copy
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from redis import Redis
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.api.dependencies import get_session
from app.main import create_app
from app.models.identity import TeamMember
from app.models.recordings import Recording
from app.models.wcl import WclImport, WclSnapshot
from app.services.identity.provisioning import ProvisioningService
from app.services.wcl.importing.jobs import WclJobService
from app.services.wcl.review.snapshots import ReviewSnapshots

CODE = "AbCdEfGh12345678"


@pytest.fixture
def local_wcl():
    """通过真正 loopback HTTP 交换 Basic／Bearer／GraphQL，不打印令牌。"""
    state = {"revision": 1, "mode": "ok", "pages": [], "requests": 0}
    report = {"code": CODE, "visibility": "public", "revision": 1, "startTime": 1000000, "endTime": 1010000,
        "fights": [{"id": 1, "encounterID": 1, "difficulty": 16, "startTime": 0, "endTime": 10000,
            "inProgress": False, "friendlyPlayers": [1, 2], "enemyNPCs": [{"id": 10}]}],
        "masterData": {"actors": [{"id": 1, "type": "Player", "name": "自己", "gameID": 111},
            {"id": 2, "type": "Player", "name": "队友"}, {"id": 10, "type": "NPC", "name": "首领"}],
            "abilities": [{"gameID": 123, "name": "协议测试技能", "icon": "test.jpg"}]}}

    class Handler(BaseHTTPRequestHandler):
        """只提供测试协议，异常消息不含业务访问凭证。"""

        def do_POST(self):
            """验证认证用途并返回有空页的标准 GraphQL 响应。"""
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            state["requests"] += 1
            if self.path == "/oauth/token":
                assert self.headers["Authorization"].startswith("Basic ")
                assert raw == b"grant_type=client_credentials"
                payload = {"access_token": "offline-http-wcl", "expires_in": 3600}
            else:
                assert self.path == "/api/v2/client"
                assert self.headers["Authorization"] == "Bearer offline-http-wcl"
                body = json.loads(raw)
                assert body["variables"]["code"] == CODE
                value = copy.deepcopy(report)
                value["revision"] = state["revision"]
                if "fightEnd" in state:
                    value["fights"][0]["endTime"] = state["fightEnd"]
                if "query Events" in body["query"]:
                    start = body["variables"]["start"]
                    state["pages"].append(start)
                    if state["mode"] == "loop":
                        page = {"data": [], "nextPageTimestamp": start}
                    elif "reviewEvents" in state:
                        page = {"data": [event for event in state["reviewEvents"] if start <= event["timestamp"] <= body["variables"]["end"]], "nextPageTimestamp": None}
                    elif start == 0:
                        page = {"data": [], "nextPageTimestamp": 100}
                    elif start == 100:
                        page = {"data": [{"type": "cast", "timestamp": stamp, "sourceID": actor, "abilityGameID": 123}
                            for stamp, actor in [(100, 1), (150, 2), (200, 10)]], "nextPageTimestamp": 300}
                    else:
                        page = {"data": [{"type": "applybuff", "timestamp": 350, "sourceID": 2, "targetID": 1, "abilityGameID": 123},
                            {"type": "death", "timestamp": 400, "targetID": 1},
                            {"type": "refreshbuff", "timestamp": 650, "sourceID": 2, "targetID": 1, "abilityGameID": 123},
                            {"type": "refreshdebuff", "timestamp": 700, "sourceID": 10, "targetID": 1, "abilityGameID": 123},
                            {"type": "empowerstart", "timestamp": 750, "sourceID": 2, "abilityGameID": 123},
                            {"type": "empowerend", "timestamp": 800, "sourceID": 2, "abilityGameID": 123, "empowermentLevel": 3},
                            {"type": "resurrect", "timestamp": 850, "sourceID": 2, "targetID": 1, "abilityGameID": 123}], "nextPageTimestamp": None}
                    value = {"revision": state["revision"], "events": page}
                payload = {"data": {"reportData": {"report": value}}}
            encoded = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def log_message(self, *_):
            """禁止标准库记录请求与认证数据。"""
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", state
    finally:
        server.shutdown()
        thread.join(timeout=3)
        server.server_close()


@pytest.mark.skipif(os.getenv("WOW_RUN_SERVICE_TESTS") != "1", reason="未显式提供隔离 PostgreSQL 环境")
def test_wcl_import_publish_pages_scope_and_failed_refresh(settings, registration, local_wcl):
    """真实迁移／API／HTTP 导入，验证失败保旧、跨视角重置、权限和共同零点。"""
    origin, state = local_wcl
    settings = settings.model_copy(update={"database_url": SecretStr(os.environ["WOW_TEST_DATABASE_URL"]),
        "wcl_client_id": SecretStr("offline-client"), "wcl_client_secret": SecretStr("offline-secret"),
        "wcl_token_url": origin + "/oauth/token", "wcl_api_url": origin + "/api/v2/client",
        "playback_signing_key": SecretStr("offline-signing-" + uuid4().hex)})
    engine = create_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    schema = "wow_wcl_test_" + uuid4().hex
    try:
        with engine.begin() as admin:
            admin.execute(CreateSchema(schema))
        with engine.connect() as connection:
            connection.execute(text("SELECT set_config('search_path', :schema, false)"), {"schema": schema})
            connection.commit()
            config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
            factory = sessionmaker(bind=connection, expire_on_commit=False)
            with factory() as session:
                provision = ProvisioningService(session, settings)
                leader, member, outsider = [provision.create_user("WCL测试" + uuid4().hex) for _ in range(3)]
                team = provision.create_team("WCL协议测试", leader.id)
                provision.add_member(team.id, member.id, "member")
                tokens = [provision.issue_token(user.id, "offline")[1] for user in [leader, member, outsider]]
            app = create_app(settings)

            def scoped_session():
                """API 只访问这个测试的真实隔离 schema。"""
                with factory() as session:
                    yield session

            app.dependency_overrides[get_session] = scoped_session
            with TestClient(app) as http:
                headers, member_headers, outside_headers = [{"Authorization": "Bearer " + token} for token in tokens]
                data = registration.model_dump(mode="json", by_alias=True)
                data.update(teamId=str(team.id), encounterStartUnixMs=1000500, encounterEndUnixMs=1010500)
                first = http.post("/api/v1/recordings", json=data, headers=headers).json()
                data.update(localPullId="second-view", teamPullId=first["teamPullId"], characterGuid="Player-2")
                second = http.post("/api/v1/recordings", json=data, headers=headers).json()
                base = f"/api/v1/teams/{team.id}/pulls/{first['teamPullId']}/wcl"
                event_path = f"/api/v1/teams/{team.id}/recordings/{first['recordingId']}/events"
                assert http.get(event_path, headers=headers).status_code == 409
                assert http.get(base, headers=member_headers).json()["canImport"] is False
                request = {"reportCode": CODE, "fightId": 1,
                    "actorBindings": [{"recordingId": first["recordingId"], "actorId": 1},
                        {"recordingId": second["recordingId"], "actorId": 2}]}
                assert http.post(base + "/imports", json=request, headers=member_headers).status_code == 403
                assert http.get(base, headers=outside_headers).status_code == 403
                bad_binding = {**request, "actorBindings": [{"recordingId": str(uuid4()), "actorId": 1}]}
                assert http.post(base + "/imports", json=bad_binding, headers=headers).status_code == 404
                disabled = settings.model_copy(update={"wcl_client_secret": None})
                app.state.settings = disabled
                assert http.get(base, headers=headers).json()["configured"] is False
                assert http.post(base + "/imports", json=request, headers=headers).status_code == 503
                app.state.settings = settings
                submitted = http.post(base + "/imports", json=request, headers=headers)
                assert submitted.status_code == 202, submitted.text
                job_id = UUID(submitted.json()["jobId"])
                repeat = http.post(base + "/imports", json=request, headers=headers).json()
                assert repeat["jobId"] == str(job_id)
                service = WclJobService(factory, settings)
                assert service.dispatch(lambda _: (_ for _ in ()).throw(RuntimeError("offline broker"))) == 0
                service.run(job_id)
                assert state["pages"] == [0, 100, 300]
                published = http.get(base, headers=headers).json()
                assert published["status"] == "ready" and published["eventCount"] == 10
                assert published["rawEventCount"] == 10 and published["publishedReportRevision"] == 1
                manifest = http.get(f"/api/v1/teams/{team.id}/pulls/{first['teamPullId']}/replay", headers=member_headers).json()
                assert all(view["timelineComplete"] and view["timelineEventCount"] == 10 for view in manifest["views"])
                page = http.get(event_path + "?limit=2", headers=member_headers).json()
                assert next(view for view in manifest["views"] if view["recordingId"] == first["recordingId"])["timelineRevision"] == page["revision"]
                assert page["total"] == 10 and page["hasMore"] and page["events"][0]["pullTimeMs"] == -400
                assert [event["owner"] for event in page["events"]] == ["player", "team"]
                continuation = http.get(event_path, params={"cursor": page["nextCursor"]}, headers=headers).json()
                assert [event["owner"] for event in continuation["events"]] == ["boss", "player", "player", "player", "player", "team", "team", "player"]
                extended = continuation["events"][3:]
                assert [event["kind"] for event in extended] == ["buffRefresh", "debuffRefresh", "empowerStart", "empowerEnd", "resurrect"]
                assert extended[3]["empowerLevel"] == 3 and extended[4]["targetActorId"] == 1
                other = http.get(event_path.replace(first["recordingId"], second["recordingId"]),
                    params={"cursor": page["nextCursor"]}, headers=headers).json()
                assert other["reset"] and other["events"][0]["owner"] == "team" and other["events"][1]["owner"] == "player"
                assert http.get(event_path, params={"cursor": page["nextCursor"] + "bad"}, headers=headers).status_code == 422
                catalog = http.get(f"/api/v1/teams/{team.id}/recordings", headers=headers).json()
                own_entry = next(entry for entry in catalog if entry["recordingId"] == first["recordingId"])
                assert own_entry["timelineRevision"] == page["revision"] and own_entry["timelineComplete"] is True
                with factory() as session:
                    ProvisioningService(session, settings).add_member(team.id, member.id, "analyst")
                assert http.get(base, headers=member_headers).json()["canImport"] is True
                assert http.post(base + "/imports", json=request, headers=member_headers).status_code == 202
                with factory() as session:
                    ProvisioningService(session, settings).add_member(team.id, member.id, "member")
                with factory() as session:
                    before_manifest = copy.deepcopy(session.get(Recording, UUID(first["recordingId"])).manifest)
                # 相同内容默认幂等，不触发多次联网；refresh 才重新导入。
                assert http.post(base + "/imports", json=request, headers=headers).json()["status"] == "ready"
                request["refresh"] = True
                state["mode"] = "loop"
                assert http.post(base + "/imports", json=request, headers=headers).json()["status"] == "pending"
                service.run(job_id)
                failed = http.get(base, headers=headers).json()
                assert failed["status"] == "failed" and failed["revision"] == published["revision"]
                assert http.get(event_path, headers=headers).json()["revision"] == page["revision"]
                state["mode"], state["revision"] = "ok", 2
                http.post(base + "/imports", json=request, headers=headers)
                WclJobService(factory, settings.model_copy(update={"wcl_max_staged_bytes": 1})).run(job_id)
                limited = http.get(base, headers=headers).json()
                assert limited["status"] == "failed" and "磁盘预算" in limited["error"]
                assert limited["revision"] == published["revision"]
                http.post(base + "/imports", json=request, headers=headers)
                service.run(job_id)
                updated = http.get(event_path, params={"cursor": page["nextCursor"]}, headers=headers).json()
                assert updated["reset"] and updated["revision"] != page["revision"]
                with factory() as session:
                    assert session.get(Recording, UUID(first["recordingId"])).manifest == before_manifest
                    assert len(session.scalars(select(WclSnapshot)).all()) == 2
                    assert session.get(WclImport, job_id).status == "ready"
                # 入队后失去管理角色不能继续执行，已发布事件不受影响。
                http.post(base + "/imports", json=request, headers=headers)
                with factory() as session:
                    ProvisioningService(session, settings).add_member(team.id, leader.id, "member")
                requests_before = state["requests"]
                service.run(job_id)
                assert state["requests"] == requests_before
                assert http.get(base, headers=headers).json()["status"] == "failed"
                assert http.get(event_path, headers=member_headers).json()["total"] == 10
                with factory() as session:
                    session.delete(session.get(TeamMember, (team.id, member.id)))
                    session.commit()
                assert http.get(event_path, headers=member_headers).status_code == 403
    finally:
        with engine.begin() as admin:
            admin.execute(DropSchema(schema, cascade=True, if_exists=True))
        engine.dispose()


@pytest.mark.skipif(os.getenv("WOW_RUN_SERVICE_TESTS") != "1", reason="未显式提供隔离PostgreSQL环境")
def test_team_death_window_real_http_scope_and_snapshot(settings, registration, local_wcl):
    """真实PG与loopback WCL验证完整死亡分页、数值、权限及换版，不上传原日志。"""
    origin, state = local_wcl
    state.update(fightEnd=40000, reviewEvents=[
        {"type": "applybuff", "timestamp": 1000, "sourceID": 2, "targetID": 1, "abilityGameID": 123},
        {"type": "damage", "timestamp": 7000, "sourceID": 10, "targetID": 1, "abilityGameID": 123, "amount": 0, "absorbed": 0,
            "targetResources": {"hitPoints": 80, "maxHitPoints": 100}},
        {"type": "heal", "timestamp": 9000, "sourceID": 2, "targetID": 1, "abilityGameID": 123, "amount": 20, "overheal": 0},
        {"type": "cast", "timestamp": 11000, "sourceID": 1, "targetID": 1, "abilityGameID": 123},
        {"type": "damage", "timestamp": 15000, "sourceID": -1, "targetID": 1, "abilityGameID": 123, "amount": 100,
            "sourceResources": {"hitPoints": 99, "maxHitPoints": 100}},
        {"type": "damage", "timestamp": 16000, "sourceID": 1, "targetID": 2, "abilityGameID": 123, "amount": 500},
        {"type": "death", "timestamp": 20000, "targetID": 1}])
    settings = settings.model_copy(update={"database_url": SecretStr(os.environ["WOW_TEST_DATABASE_URL"]),
        "wcl_client_id": SecretStr("offline-client"), "wcl_client_secret": SecretStr("offline-secret"),
        "wcl_token_url": origin + "/oauth/token", "wcl_api_url": origin + "/api/v2/client",
        "playback_signing_key": SecretStr("offline-signing-" + uuid4().hex)})
    if os.getenv("WOW_TEST_REDIS_URL"):
        settings = settings.model_copy(update={"redis_url": SecretStr(os.environ["WOW_TEST_REDIS_URL"]), "processing_queue": "wow-death-test-" + uuid4().hex})
    engine = create_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    schema = "wow_death_test_" + uuid4().hex
    try:
        with engine.begin() as admin:
            admin.execute(CreateSchema(schema))
        with engine.connect() as connection:
            connection.execute(text("SELECT set_config('search_path', :schema, false)"), {"schema": schema})
            connection.commit()
            migration = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
            migration.attributes["connection"] = connection
            command.upgrade(migration, "head")
            connection.commit()
            factory = sessionmaker(bind=connection, expire_on_commit=False)
            with factory() as session:
                provision = ProvisioningService(session, settings)
                owner, member, outsider = [provision.create_user("死亡协议" + uuid4().hex) for _ in range(3)]
                team = provision.create_team("死亡窗口协议", owner.id)
                provision.add_member(team.id, member.id, "member")
                tokens = [provision.issue_token(user.id, "offline")[1] for user in [owner, member, outsider]]
            app = create_app(settings)

            def scoped_session():
                """只使用本测试创建的真实隔离schema。"""
                with factory() as session:
                    yield session

            app.dependency_overrides[get_session] = scoped_session
            with TestClient(app) as http:
                headers, member_headers, outside_headers = [{"Authorization": "Bearer " + token} for token in tokens]
                data = registration.model_dump(mode="json", by_alias=True)
                data.update(teamId=str(team.id), encounterStartUnixMs=1000000, encounterEndUnixMs=1040000, videoDurationMs=45000, videoZeroMs=0)
                first_response = http.post("/api/v1/recordings", json=data, headers=headers)
                assert first_response.status_code == 201, first_response.text
                first = first_response.json()
                data.update(localPullId="death-second-view", teamPullId=first["teamPullId"], characterGuid="Player-2")
                second = http.post("/api/v1/recordings", json=data, headers=headers).json()
                base = f"/api/v1/teams/{team.id}"
                path = base + f"/recordings/{first['recordingId']}/death-review"
                assert http.get(path, params={"event_id": "unknown"}, headers=member_headers).status_code == 409
                request = {"reportCode": CODE, "fightId": 1, "actorBindings": [{"recordingId": first["recordingId"], "actorId": 1}, {"recordingId": second["recordingId"], "actorId": 2}]}
                submitted = http.post(base + f"/pulls/{first['teamPullId']}/wcl/imports", json=request, headers=headers)
                assert submitted.status_code == 202, submitted.text
                WclJobService(factory, settings).run(UUID(submitted.json()["jobId"]))
                timeline = http.get(base + f"/recordings/{first['recordingId']}/events", headers=headers).json()
                assert timeline["total"] == 3
                death = next(event for event in timeline["events"] if event["kind"] == "death")
                params = {"event_id": death["eventId"], "limit": 2}
                first_page_response = http.get(path, params=params, headers=member_headers)
                assert first_page_response.status_code == 200, first_page_response.text
                page = first_page_response.json()
                assert page["sourceKind"] == "wcl" and page["availability"] == "ready" and page["hasMore"]
                assert page["windowStartMs"] == 5000 and page["windowEndMs"] == 20000
                assert page["events"][0]["amount"] == 0 and page["events"][0]["health"] == 80
                assert page["events"][1]["overheal"] == 0 and len(page["priorAuras"]) == 1
                assert page["victimRecordingIds"] == [first["recordingId"]] and page["relatedRecordingIds"] == [second["recordingId"]]
                rows, cursor = list(page["events"]), page["nextCursor"]
                requests_after_first = state["requests"]
                while cursor:
                    following = http.get(path, params={**params, "cursor": cursor}, headers=member_headers)
                    assert following.status_code == 200, following.text
                    value = following.json()
                    assert value["revision"] == page["revision"] and value["priorAuras"] == []
                    rows.extend(value["events"])
                    cursor = value["nextCursor"]
                assert len(rows) == page["total"] == 5
                assert rows[-2]["sourceActorId"] == -1 and rows[-2]["health"] is None
                assert rows[-1]["eventId"] == death["eventId"]
                if settings.redis_url:
                    assert state["requests"] == requests_after_first, "后续页应命中真实Redis快照"
                    with factory() as session:
                        job = session.scalar(select(WclImport).where(WclImport.team_pull_id == UUID(first["teamPullId"])))
                        cache_key = ReviewSnapshots(settings).key([str(team.id), first["recordingId"], str(job.snapshot_id), death["eventId"]])
                    with Redis.from_url(settings.redis_url.get_secret_value()) as cache:
                        assert 0 < cache.ttl(cache_key) <= settings.death_review_cache_ttl_seconds
                before_requests = state["requests"]
                assert http.get(path, params=params, headers=outside_headers).status_code == 403
                assert state["requests"] == before_requests
                assert http.get(path, params={**params, "event_id": "wrong-death"}, headers=headers).status_code == 404
                assert http.get(path, params={**params, "cursor": page["nextCursor"] + "tampered"}, headers=headers).status_code == 422
                assert http.get(path.replace(first["recordingId"], second["recordingId"]), params={**params, "cursor": page["nextCursor"]}, headers=headers).status_code == 409
                assert http.get(path, params={**params, "limit": 251}, headers=headers).status_code == 422
                app.state.settings = settings.model_copy(update={"wcl_client_secret": None})
                assert http.get(path, params=params, headers=headers).json()["availability"] == "notConfigured"
                app.state.settings = settings
                state["reviewEvents"][1]["amount"] = 1
                if settings.redis_url:
                    with Redis.from_url(settings.redis_url.get_secret_value()) as cache:
                        cache.delete(cache_key)
                assert http.get(path, params={**params, "cursor": page["nextCursor"]}, headers=headers).status_code == 409
                state["revision"] = 2
                assert http.get(path, params={**params, "refresh": True}, headers=headers).json()["availability"] == "reportChanged"
                assert http.get(base + f"/recordings/{first['recordingId']}/events", headers=headers).json()["revision"] == timeline["revision"]
                with factory() as session:
                    session.delete(session.get(TeamMember, (team.id, member.id)))
                    session.commit()
                assert http.get(path, params=params, headers=member_headers).status_code == 403
    finally:
        if settings.redis_url:
            with Redis.from_url(settings.redis_url.get_secret_value()) as cache:
                keys = list(cache.scan_iter(match=settings.processing_queue + ":death-review:*"))
                if keys:
                    cache.delete(*keys)
        with engine.begin() as admin:
            admin.execute(DropSchema(schema, cascade=True, if_exists=True))
        engine.dispose()
