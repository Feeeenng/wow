"""需要显式隔离 PostgreSQL 与 S3 配置的真正服务联调，不使用 SQLite。"""

import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path
from uuid import UUID, uuid4

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateSchema, DropSchema

from app.api.dependencies import get_session
from app.core.config import Settings
from app.main import create_app
from app.models.identity import TeamMember
from app.models.processing import ProcessingJob, ProcessingOutbox
from app.models.recordings import Recording
from app.models.uploads import Upload
from app.schemas.recordings import RegisterRecording
from app.services.identity.provisioning import ProvisioningService
from app.services.uploads.storage import S3Storage

pytestmark = pytest.mark.skipif(os.getenv("WOW_RUN_SERVICE_TESTS") != "1", reason="未显式提供隔离 PostgreSQL／S3 联调环境")


def _exercise_postgres_s3(tmp_path, process_media: bool):
    """真实迁移、私有桶、签名 PUT、恢复确认和完成；仅清理本测试 schema 与对象。"""
    required = ["WOW_TEST_DATABASE_URL", "WOW_TEST_S3_ENDPOINT_URL", "WOW_TEST_S3_PUBLIC_ENDPOINT_URL",
                "WOW_TEST_S3_ACCESS_KEY", "WOW_TEST_S3_SECRET_KEY", "WOW_TEST_S3_BUCKET"]
    if process_media:
        required.append("WOW_TEST_REDIS_URL")
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        pytest.fail("显式开启联调但缺少变量：" + ",".join(missing))
    settings = Settings(database_url=os.environ["WOW_TEST_DATABASE_URL"],
        s3_endpoint_url=os.environ["WOW_TEST_S3_ENDPOINT_URL"], s3_public_endpoint_url=os.environ["WOW_TEST_S3_PUBLIC_ENDPOINT_URL"],
        s3_access_key=os.environ["WOW_TEST_S3_ACCESS_KEY"], s3_secret_key=os.environ["WOW_TEST_S3_SECRET_KEY"],
        s3_bucket=os.environ["WOW_TEST_S3_BUCKET"], multipart_part_size_bytes=5 * 1024**2,
        playback_signing_key="test-only-" + uuid4().hex, redis_url=os.getenv("WOW_TEST_REDIS_URL"),
        processing_dispatch_interval_seconds=1, processing_queue="wow-test-" + uuid4().hex, _env_file=None)
    root = Path(__file__).resolve().parents[3]
    ffmpeg = os.getenv("WOW_TEST_FFMPEG_PATH") or shutil.which("ffmpeg") or (str(root / "client/src-tauri/resources/ffmpeg-runtime/bin/ffmpeg.exe") if os.name == "nt" else None)
    ffprobe = os.getenv("WOW_TEST_FFPROBE_PATH") or shutil.which("ffprobe") or (str(root / "client/src-tauri/resources/ffmpeg-runtime/probe/bin/ffprobe.exe") if os.name == "nt" else None)
    if not ffmpeg or not ffprobe:
        pytest.fail("真实联调必须提供 FFmpeg／ffprobe，不以非视频字节伪造处理完成")
    settings = settings.model_copy(update={"ffmpeg_path": ffmpeg, "ffprobe_path": ffprobe})
    source = tmp_path / "synthetic.mp4"
    encoders = subprocess.run([ffmpeg, "-hide_banner", "-encoders"], capture_output=True, check=True).stdout.decode()
    encoder = "libx264" if "libx264" in encoders else "libopenh264"
    subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
                    "-t", "3", "-c:v", encoder, "-g", "25", str(source)], capture_output=True, check=True, timeout=30)
    # 合法 MP4 free atom 增加体积，真实触发至少两片上传，不改变视频内容。
    padding_size = 6 * 1024**2
    with source.open("ab") as padded:
        padded.write(struct.pack(">I4s", padding_size, b"free") + bytes(padding_size - 8))
    schema = "wow_test_" + uuid4().hex
    engine = create_engine(settings.database_url.get_secret_value(), hide_parameters=True)
    storage = S3Storage(settings)
    storage.initialize_private_bucket()
    object_keys, storage_sessions, processes = [], set(), []
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
                user = provision.create_user("联调上传者" + uuid4().hex)
                outsider = provision.create_user("联调隔离者" + uuid4().hex)
                team = provision.create_team("联调团队", user.id)
                _, token = provision.issue_token(user.id, "test")
                _, outsider_token = provision.issue_token(outsider.id, "test")
            app = create_app(settings)

            def scoped_session():
                """所有 HTTP 请求使用同一隔离 schema，不访问应用正式会话。"""
                with factory() as session:
                    yield session

            app.dependency_overrides[get_session] = scoped_session
            payload = source.read_bytes()
            digest = hashlib.sha256(payload).hexdigest()
            registration = RegisterRecording(teamId=team.id, deviceId="test", localPullId="test", artifactVersion=digest,
                fileSizeBytes=len(payload), fileSha256=digest, characterGuid="Player-1", characterName="测试角色",
                encounterId=1, encounterName="测试首领", difficultyId=16, encounterStartUnixMs=1000,
                encounterEndUnixMs=6000, videoZeroMs=0, videoDurationMs=5000)
            with TestClient(app) as client:
                headers = {"Authorization": "Bearer " + token}
                response = client.post("/api/v1/recordings", headers=headers, json=registration.model_dump(mode="json", by_alias=True))
                assert response.status_code == 201, response.text
                task = response.json()
                upload_id = task["uploadId"]
                with factory() as session:
                    upload = session.get(Upload, UUID(upload_id))
                    object_keys.append(upload.object_key)
                repeated = client.post("/api/v1/recordings", headers=headers, json=registration.model_dump(mode="json", by_alias=True)).json()
                assert repeated["uploadId"] == upload_id
                assert client.get(f"/api/v1/uploads/{upload_id}/status", headers={"Authorization": "Bearer " + outsider_token}).status_code == 404
                size = task["partSizeBytes"]
                for index in range(math.ceil(len(payload) / size)):
                    part = payload[index * size:(index + 1) * size]
                    signed = client.post(f"/api/v1/uploads/{upload_id}/parts", headers=headers,
                                         json={"partNumber": index + 1, "checksumSha256": hashlib.sha256(part).hexdigest()})
                    assert signed.status_code == 200, signed.text
                    link = signed.json()
                    with factory() as session:
                        current = session.get(Upload, UUID(upload_id))
                        storage_sessions.add((current.object_key, current.storage_upload_id))
                    put = httpx.put(link["url"], content=part, headers=link["headers"], timeout=30)
                    assert put.status_code == 200
                    # 第一片故意不 confirm，由下一次 status 从 S3 真值恢复。
                    restored = client.get(f"/api/v1/uploads/{upload_id}/status", headers=headers)
                    assert len(restored.json()["confirmedParts"]) == index + 1
                completed = client.post(f"/api/v1/uploads/{upload_id}/complete", headers=headers)
                assert completed.status_code == 200, completed.text
                assert completed.json()["uploadStatus"] == "uploaded"
                assert completed.json()["recordingStatus"] == "uploaded"
                manifest = client.get(f"/api/v1/teams/{team.id}/pulls/{task['teamPullId']}/replay", headers=headers).json()
                assert manifest["views"][0]["playbackUrl"] is None
                assert client.post(f"/api/v1/uploads/{upload_id}/complete", headers=headers).status_code == 200
                if not process_media:
                    return
                with factory() as session:
                    job = session.scalar(select(ProcessingJob).where(ProcessingJob.recording_id == UUID(task["recordingId"])))
                    assert job is not None
                # 真实独立 worker／beat 经 Redis 消费 outbox，不使用 eager 或同步执行伪装队列。
                environment = dict(os.environ)
                for field, value in settings.model_dump().items():
                    name = "WOW_" + field.upper()
                    if value is None:
                        environment.pop(name, None)
                    else:
                        raw = value.get_secret_value() if hasattr(value, "get_secret_value") else value
                        environment[name] = json.dumps(raw) if isinstance(raw, (list, dict)) else str(raw)
                isolated_url = make_url(settings.database_url.get_secret_value()).update_query_dict({"options": f"-csearch_path={schema}"})
                environment["WOW_DATABASE_URL"] = isolated_url.render_as_string(hide_password=False)
                for name, args in [
                    ("worker", ["worker", "--pool=solo", "--concurrency=1", "--loglevel=WARNING", "--without-gossip", "--without-mingle"]),
                    ("beat", ["beat", "--loglevel=WARNING", f"--schedule={tmp_path / 'beat-schedule'}", f"--pidfile={tmp_path / 'beat.pid'}"]),
                ]:
                    with (tmp_path / f"{name}.log").open("wb") as output:
                        processes.append(subprocess.Popen([sys.executable, "-m", "celery", "-A", "app.worker:celery_app", *args],
                            cwd=Path(__file__).resolve().parents[2], env=environment, stdout=output, stderr=output,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    with factory() as session:
                        published = session.get(Recording, UUID(task["recordingId"]))
                        if published.status == "ready":
                            break
                        assert published.status != "failed", published.processing_error
                    assert all(process.poll() is None for process in processes), "独立 worker／beat 提前退出"
                    time.sleep(0.25)
                with factory() as session:
                    published = session.get(Recording, UUID(task["recordingId"]))
                    assert published.status == "ready", published.processing_error
                    assert published.file_sha256_verified is True and published.playback_version is not None
                    completed_job = session.get(ProcessingJob, job.id)
                    outbox = session.get(ProcessingOutbox, job.id)
                    assert completed_job.status == "ready" and completed_job.attempts == 1
                    assert outbox.published_at is not None and outbox.attempts >= 1
                    listing = storage.client.list_objects_v2(Bucket=settings.s3_bucket, Prefix=published.playback_key.rsplit("/", 1)[0] + "/")
                    object_keys.extend(item["Key"] for item in listing.get("Contents", []))
                catalog = client.get(f"/api/v1/teams/{team.id}/recordings", headers=headers).json()
                assert catalog[0]["status"] == "ready" and catalog[0]["playbackVersion"]
                path = f"/api/v1/teams/{team.id}/recordings/{task['recordingId']}/media/"
                playlist = client.get(path + "index.m3u8", params={"version": catalog[0]["playbackVersion"]}, headers=headers)
                assert playlist.status_code == 200 and "#EXT-X-ENDLIST" in playlist.text and "?grant=" not in playlist.text
                segment = next(line for line in playlist.text.splitlines() if line.startswith("segment-"))
                assert client.get(path + segment, params={"version": catalog[0]["playbackVersion"]}, headers={**headers, "Range": "bytes=0-15"}).status_code == 206
                from urllib.parse import urlsplit
                web_manifest = client.get(f"/api/v1/teams/{team.id}/pulls/{task['teamPullId']}/replay", headers=headers).json()
                web_link = urlsplit(web_manifest["views"][0]["playbackUrl"])
                grant_playlist = client.get(web_link.path + "?" + web_link.query)
                assert grant_playlist.status_code == 200
                assert 'URI="init.mp4?grant=' in grant_playlist.text
                grant_segment = next(line for line in grant_playlist.text.splitlines() if line.startswith("segment-"))
                assert "?grant=" in grant_segment
                assert client.get(path + grant_segment).status_code == 200
                assert client.get(path + "init.mp4?" + web_link.query).status_code == 200
                with factory() as session:
                    session.delete(session.get(TeamMember, (team.id, user.id)))
                    session.commit()
                assert client.get(path + segment, params={"version": catalog[0]["playbackVersion"]}, headers=headers).status_code == 404
                assert client.get(path + grant_segment).status_code == 404
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        for key, storage_id in storage_sessions:
            storage.abort(key, storage_id)
        for key in object_keys:
            storage.client.delete_object(Bucket=settings.s3_bucket, Key=key)
        with engine.begin() as admin:
            admin.execute(DropSchema(schema, cascade=True))
        engine.dispose()
        # 只清理本测试独立队列前缀，不使用 FLUSHDB 或删除共享业务键。
        if settings.redis_url:
            from redis import Redis
            broker = Redis.from_url(settings.redis_url.get_secret_value())
            try:
                prefix = f"{settings.processing_queue}:".encode()
                keys = [key for key in broker.scan_iter(match=prefix.decode() + "*") if key.startswith(prefix)]
                if keys:
                    broker.delete(*keys)
            finally:
                broker.close()


def test_postgres_s3_upload_and_team_scope(tmp_path):
    """独立验证真实 PG／S3 迁移、权限、幂等及 Multipart，不依赖 Redis。"""
    _exercise_postgres_s3(tmp_path, process_media=False)


@pytest.mark.skipif(not os.getenv("WOW_TEST_REDIS_URL"), reason="尚未提供隔离 Redis，不能冒充真实 Celery 交付")
def test_postgres_s3_processing_via_real_celery(tmp_path):
    """真实 broker／worker／beat 领取后验证私有媒体发布与撤销。"""
    _exercise_postgres_s3(tmp_path, process_media=True)
