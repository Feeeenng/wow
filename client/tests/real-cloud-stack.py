"""为原生客户端验收建立随机隔离的真实 PG／S3／Redis／Celery 环境。"""

import argparse
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote
from uuid import UUID, uuid4


class SanitizedStream:
    """过滤服务凭证和个人令牌，不将敏感输入写入验收日志。"""

    def __init__(self, stream, sensitive):
        self.stream, self.sensitive = stream, sensitive

    def write(self, value):
        for secret in self.sensitive:
            if secret:
                value = value.replace(secret, "[已隐藏]")
        return self.stream.write(value)

    def flush(self):
        self.stream.flush()


def emit(value):
    """仅向父 Node 管道交付数据，父进程不得打印令牌字段。"""
    sys.__stdout__.write(json.dumps(value, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()


def main():
    """所有数据库、对象和 Redis 操作均限定本次随机命名空间。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--private", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--with-wcl", action="store_true")
    args = parser.parse_args()
    sys.__stdout__.reconfigure(encoding="utf-8")
    sys.__stderr__.reconfigure(encoding="utf-8")
    root = Path(__file__).resolve().parents[2]
    backend = root / "backend"
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    private = json.loads(Path(args.private).read_text(encoding="utf-8"))
    sensitive = [str(private[key]) for key in ["pg_password", "s3_access", "s3_secret", "redis_password"]]
    sensitive.extend(quote(value, safe="") for value in list(sensitive))
    sys.stderr = SanitizedStream(sys.__stderr__, sensitive)
    sys.stdout = SanitizedStream(sys.__stderr__, sensitive)
    sys.path.insert(0, str(backend))
    os.chdir(backend)
    from sqlalchemy import create_engine, select, text
    from sqlalchemy.engine import URL
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.schema import CreateSchema, DropSchema
    from alembic import command
    from alembic.config import Config
    from app.core.config import Settings
    from app.models.identity import TeamMember
    from app.models.recordings import Recording, TeamPull
    from app.models.processing import ProcessingJob, ProcessingOutbox
    from app.models.uploads import Upload, UploadPart
    from app.models.wcl import WclImport,WclSnapshot
    from app.models.annotations import AnnotationSnapshot
    from app.services.identity.provisioning import ProvisioningService
    from app.services.uploads.storage import S3Storage

    suffix = uuid4().hex
    schema = "wow_native_" + suffix
    bucket = "wow-native-" + suffix
    queue = "wow-native-" + suffix
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}"
    wcl = None
    wcl_options = {"wcl_client_id":None,"wcl_client_secret":None}
    if args.with_wcl:
        from wcl_protocol_fixture import WclProtocolFixture
        wcl = WclProtocolFixture()
        wcl_options = {"wcl_client_id":wcl.client_id,"wcl_client_secret":wcl.client_secret,
            "wcl_token_url":wcl.origin + "/oauth/token","wcl_api_url":wcl.origin + "/api/v2/client"}
        sensitive.extend([wcl.client_id,wcl.client_secret,wcl.access_token])
    base = URL.create("postgresql+psycopg", username="wowtest", password=private["pg_password"], host="127.0.0.1", port=25432, database="postgres")
    isolated = base.update_query_dict({"options": "-csearch_path=" + schema})
    redis_url = "redis://:" + quote(private["redis_password"], safe="") + "@127.0.0.1:26379/0"
    settings = Settings(database_url=isolated.render_as_string(hide_password=False),
        s3_endpoint_url="http://127.0.0.1:29000", s3_public_endpoint_url="http://127.0.0.1:29000",
        s3_access_key=private["s3_access"], s3_secret_key=private["s3_secret"], s3_bucket=bucket,
        redis_url=redis_url, processing_queue=queue, multipart_part_size_bytes=5 * 1024**2,
        processing_dispatch_interval_seconds=1, public_api_url=endpoint, playback_signing_key=secrets.token_urlsafe(48),
        ffmpeg_path=str(root / "client/src-tauri/resources/ffmpeg-runtime/bin/ffmpeg.exe"),
        ffprobe_path=str(root / "client/src-tauri/resources/ffmpeg-runtime/probe/bin/ffprobe.exe"),
        processing_temp_directory=str(output / "processing"), _env_file=None, **wcl_options)
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(backend)
    environment["PYTHONIOENCODING"] = "utf-8"
    for field, value in settings.model_dump().items():
        name = "WOW_" + field.upper()
        if value is None:
            environment.pop(name, None)
        else:
            raw = value.get_secret_value() if hasattr(value, "get_secret_value") else value
            environment[name] = json.dumps(raw) if isinstance(raw, (list, dict)) else str(raw)
    sensitive.extend([environment["WOW_DATABASE_URL"], environment["WOW_REDIS_URL"], environment["WOW_PLAYBACK_SIGNING_KEY"]])
    os.environ.update({key: value for key, value in environment.items() if key.startswith("WOW_")})
    admin_engine = create_engine(base, hide_parameters=True)
    engine = None
    storage = S3Storage(settings)
    processes, log_threads = [], []
    schema_created = bucket_created = False
    counters = output / "request-counts.json"
    environment["WOW_NATIVE_COUNTERS"] = str(counters)
    runner = output / "api-runner.py"
    runner.write_text("""import asyncio,json,os
from pathlib import Path
import uvicorn
from app.main import app
counts={'presign':[],'confirm':[]}
delayed=False
@app.middleware('http')
async def trace_request(request,call_next):
    global delayed
    route=request.url.path
    if request.method=='POST' and route.endswith('/parts'):
        payload=await request.json()
        number=payload.get('partNumber')
        counts['presign'].append(number)
        target=Path(os.environ['WOW_NATIVE_COUNTERS'])
        temporary=target.with_suffix('.tmp')
        temporary.write_text(json.dumps(counts))
        os.replace(temporary,target)
        if number==2 and not delayed:
            delayed=True
            await asyncio.sleep(5)
    elif request.method=='POST' and '/parts/' in route and route.endswith('/confirm'):
        counts['confirm'].append(int(route.split('/')[-2]))
        target=Path(os.environ['WOW_NATIVE_COUNTERS'])
        temporary=target.with_suffix('.tmp')
        temporary.write_text(json.dumps(counts))
        os.replace(temporary,target)
    return await call_next(request)
uvicorn.run(app,host='127.0.0.1',port=int(os.environ['WOW_NATIVE_API_PORT']),access_log=False,log_level='warning')
""", encoding="utf-8")
    environment["WOW_NATIVE_API_PORT"] = str(port)

    def launch(name, arguments):
        """隐藏启动服务进程，所有子进程输出经凭证过滤后保留。"""
        child = subprocess.Popen([sys.executable, *arguments], cwd=backend, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        processes.append(child)

        def drain():
            with (output / (name + ".log")).open("w", encoding="utf-8") as stream:
                sanitized = SanitizedStream(stream, sensitive)
                for line in iter(child.stdout.readline, b""):
                    sanitized.write(line.decode("utf-8", "replace"))
                    sanitized.flush()

        thread = threading.Thread(target=drain, daemon=True)
        thread.start()
        log_threads.append(thread)

    try:
        with admin_engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        schema_created = True
        with admin_engine.connect() as connection:
            connection.execute(text("SELECT set_config('search_path', :schema, false)"), {"schema": schema})
            connection.commit()
            config = Config(str(backend / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
        engine = create_engine(isolated, hide_parameters=True, pool_pre_ping=True)
        factory = sessionmaker(engine, expire_on_commit=False)
        storage.initialize_private_bucket()
        bucket_created = True
        with factory() as session:
            service = ProvisioningService(session, settings)
            user = service.create_user("原生实际云端验收" + suffix[:8])
            team = service.create_team("原生隔离云端团队", user.id)
            _, token = service.issue_token(user.id, "native-validation")
            user_id, team_id = user.id, team.id
            observer = service.create_user("原生只读成员" + suffix[:8])
            service.add_member(team_id, observer.id, "member")
            _, observer_token = service.issue_token(observer.id, "native-observer-validation")
            observer_id = observer.id
            common_pull = TeamPull(team_id=team_id, encounter_id=7001, encounter_name="真实云端合成首领", difficulty_id=16,
                started_at_unix_ms=12000, ended_at_unix_ms=22000, association_status="unverified")
            session.add(common_pull)
            session.commit()
            team_pull_id = common_pull.id
            sensitive.extend([token, observer_token])
        launch("api", [str(runner)])
        launch("worker", ["-m", "celery", "-A", "app.worker:celery_app", "worker", "--pool=solo", "--concurrency=1", "--loglevel=WARNING", "--without-gossip", "--without-mingle"])
        launch("beat", ["-m", "celery", "-A", "app.worker:celery_app", "beat", "--loglevel=WARNING", "--schedule=" + str(output / "beat-schedule"), "--pidfile=" + str(output / "beat.pid")])
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if not all(child.poll() is None for child in processes):
                raise RuntimeError("隔离 API／worker／beat 提前退出，请检查已过滤日志")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("隔离 API 未按时启动")
        emit({"event": "ready", "endpoint": endpoint, "teamId": str(team_id), "teamPullId":str(team_pull_id), "userId": str(user_id), "token": token, "observerToken":observer_token,"observerId":str(observer_id), "displayName": user.display_name,"wclReportCode":wcl.code if wcl else None})
        web_media_backup = None
        for line in sys.stdin:
            request = json.loads(line)
            action = request.get("action")
            if action == "cleanup":
                break
            if action == "revoke":
                with factory() as session:
                    member = session.get(TeamMember, (team_id, user_id))
                    if member:
                        session.delete(member)
                        session.commit()
                emit({"event": "revoked"})
            elif action == "downgrade":
                with factory() as session:
                    ProvisioningService(session,settings).add_member(team_id,user_id,"member")
                emit({"event":"downgraded"})
            elif action == "secondTeam":
                with factory() as session:
                    team = ProvisioningService(session, settings).create_team("第二隔离团队" + suffix[:8], user_id)
                    pull = TeamPull(team_id=team.id, encounter_id=7001, encounter_name="第二隔离团队首领", difficulty_id=16,
                        started_at_unix_ms=12000, ended_at_unix_ms=22000, association_status="unverified")
                    session.add(pull)
                    session.commit()
                    emit({"event": "secondTeamCreated", "teamId": str(team.id), "teamPullId": str(pull.id), "name": team.name})
            elif action in {"observerAnalyst", "observerMember"}:
                with factory() as session:
                    ProvisioningService(session,settings).add_member(team_id,observer_id,"analyst" if action == "observerAnalyst" else "member")
                emit({"event":"observerUpdated"})
            elif action in {"preferencesUnavailable", "preferencesRestore"}:
                # 只在本次随机 schema 内制造／恢复真实数据库不可用，API 错误由正式处理器返回。
                with engine.begin() as connection:
                    connection.execute(text("ALTER TABLE replay_preferences RENAME TO replay_preferences_unavailable"
                        if action == "preferencesUnavailable" else "ALTER TABLE replay_preferences_unavailable RENAME TO replay_preferences"))
                emit({"event": "preferencesStorageUpdated"})
            elif action == "calibrationVersion":
                with factory() as session:
                    recording = session.scalar(select(Recording).where(Recording.team_id == team_id,
                        Recording.character_guid == "Player-NativeReal0"))
                    old_prefix = recording.playback_key.rsplit("/", 1)[0]
                    assert old_prefix.startswith(f"{settings.object_prefix}/{team_id}/recordings/{recording.id}/playback/")
                    version = uuid4()
                    new_prefix = old_prefix.rsplit("/", 1)[0] + "/" + str(version)
                    # 同一合成媒体复制到完整新版本前缀，再原子发布；不以失配的UUID冒充有效重发布。
                    for page in storage.client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=old_prefix + "/"):
                        for item in page.get("Contents", []):
                            storage.client.copy_object(Bucket=bucket, Key=new_prefix + item["Key"][len(old_prefix):],
                                CopySource={"Bucket": bucket, "Key": item["Key"]})
                    recording.playback_version, recording.playback_key = version, new_prefix + "/index.m3u8"
                    session.commit()
                emit({"event": "calibrationVersionChanged"})
            elif action in {"webBreakMedia", "webRestoreMedia"}:
                with factory() as session:
                    recording = session.scalar(select(Recording).where(Recording.team_id == team_id,
                        Recording.character_guid == "Player-NativeReal0"))
                    key = recording.playback_key
                    assert key.startswith(f"{settings.object_prefix}/{team_id}/recordings/{recording.id}/playback/")
                    if action == "webBreakMedia":
                        source = storage.client.get_object(Bucket=bucket, Key=key)["Body"]
                        try:
                            web_media_backup = (key, source.read())
                        finally:
                            source.close()
                        storage.client.put_object(Bucket=bucket, Key=key, Body=b"invalid-playlist", ContentType="application/vnd.apple.mpegurl")
                    else:
                        assert web_media_backup is not None
                        storage.client.put_object(Bucket=bucket, Key=web_media_backup[0], Body=web_media_backup[1], ContentType="application/vnd.apple.mpegurl")
                        web_media_backup = None
                emit({"event": "webMediaUpdated"})
            elif action in {"wclFail","wclRevision","webBulkEvents","webWclHold","webWclResume"} and wcl:
                wcl.set_mode("loop" if action == "wclFail" else "bulk" if action == "webBulkEvents" else "hold" if action == "webWclHold" else "ok" if action == "webWclResume" else "revision")
                emit({"event":"wclFixtureUpdated"})
            elif action == "inspect":
                with factory() as session:
                    recordings = list(session.scalars(select(Recording).where(Recording.team_id == team_id)))
                    uploads = list(session.scalars(select(Upload).where(Upload.team_id == team_id)))
                    parts = list(session.scalars(select(UploadPart).where(UploadPart.upload_id.in_([item.id for item in uploads])))) if uploads else []
                    jobs = list(session.scalars(select(ProcessingJob).where(ProcessingJob.recording_id.in_([item.id for item in recordings])))) if recordings else []
                    outbox = list(session.scalars(select(ProcessingOutbox)))
                    data = {"event": "inspection", "recordings": [{"recordingId": str(item.id), "teamPullId":str(item.team_pull_id), "characterGuid":item.character_guid,
                        "localStartUnixMs":item.manifest["encounterStartUnixMs"],"videoZeroMs":item.manifest["videoZeroMs"],"publicationShiftMs":item.manifest.get("publicationShiftMs",0),
                        "status": item.status, "sha256Verified": item.file_sha256_verified, "fileSha256": item.file_sha256, "bytes": item.file_size_bytes,
                        "sharedCalibration": item.manifest.get("sharedCalibration")} for item in recordings],
                        "uploadCount": len(uploads), "parts": [{"number": item.part_number, "confirmed": item.confirmed_at is not None} for item in parts],
                        "jobs": [{"status": item.status, "attempts": item.attempts} for item in jobs], "publishedOutbox": sum(item.published_at is not None for item in outbox),
                        "counts": json.loads(counters.read_text()) if counters.exists() else {"presign": [], "confirm": []}}
                    data["annotations"] = [{"recordingId":str(item.recording_id),"version":item.version,"itemCount":len(item.items)}
                        for item in session.scalars(select(AnnotationSnapshot).where(AnnotationSnapshot.team_id==team_id))]
                    if wcl:
                        data["wcl"] = wcl.snapshot()
                        data["wclJobs"] = [{"status":item.status,"attempts":item.attempts,"published":item.published_at is not None}
                            for item in session.scalars(select(WclImport).where(WclImport.team_id==team_id))]
                        data["wclSnapshots"] = len(list(session.scalars(select(WclSnapshot).where(WclSnapshot.team_id==team_id))))
                emit(data)
    finally:
        for child in reversed(processes):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
        for thread in log_threads:
            thread.join(timeout=2)
        if wcl:
            wcl.close()
        cleanup_errors = []
        if bucket_created:
            try:
                assert bucket == "wow-native-" + suffix
                pending = storage.client.list_multipart_uploads(Bucket=bucket).get("Uploads", [])
                for upload in pending:
                    storage.client.abort_multipart_upload(Bucket=bucket, Key=upload["Key"], UploadId=upload["UploadId"])
                paginator = storage.client.get_paginator("list_objects_v2")
                for page in paginator.paginate(Bucket=bucket):
                    objects = [{"Key": item["Key"]} for item in page.get("Contents", [])]
                    if objects:
                        storage.client.delete_objects(Bucket=bucket, Delete={"Objects": objects})
                storage.client.delete_bucket(Bucket=bucket)
            except Exception:
                cleanup_errors.append("本次私有桶清理失败")
        if engine:
            engine.dispose()
        if schema_created:
            assert schema == "wow_native_" + suffix
            try:
                with admin_engine.begin() as connection:
                    connection.execute(DropSchema(schema, cascade=True))
            except Exception:
                cleanup_errors.append("本次隔离数据库清理失败")
        admin_engine.dispose()
        from redis import Redis
        broker = Redis.from_url(redis_url)
        try:
            prefix = (queue + ":").encode()
            keys = [key for key in broker.scan_iter(match=queue + ":*") if key.startswith(prefix)]
            if keys:
                broker.delete(*keys)
        except Exception:
            cleanup_errors.append("本次独立 Redis 前缀清理失败")
        finally:
            broker.close()
        emit({"event": "cleanup", "cleaned": not cleanup_errors, "schemaDropped": schema_created and "本次隔离数据库清理失败" not in cleanup_errors,
            "bucketDeleted": bucket_created and "本次私有桶清理失败" not in cleanup_errors, "processesStopped": all(child.poll() is not None for child in processes), "errors":cleanup_errors})


if __name__ == "__main__":
    main()
