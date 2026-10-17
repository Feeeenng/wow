"""WCL 导入任务的持久 outbox、租约与完整快照原子发布。"""

import json
import tempfile
import time
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.models.identity import TeamMember, User
from app.models.recordings import Recording, TeamPull
from app.models.wcl import WclEvent, WclImport, WclSnapshot
from app.services.wcl.adapter import WclClient, WclError, configured
from app.services.wcl.normalization import integer, metadata, normalization_indexes, normalize
from app.utils.time_utils import cst_now


@dataclass(frozen=True)
class WclClaim:
    """任务领取后不跨网络持有 PG 事务或行锁。"""

    job_id: UUID
    lease: UUID
    team_id: UUID
    pull_id: UUID
    request: dict


class WclJobService:
    """调度可恢复导入，broker 丢失或重复消息都以 PG 状态为准。"""

    def __init__(self, factory, settings: Settings, client_factory=WclClient):
        """测试仅替换 HTTP transport，数据库和事务仍可使用真实 PG。"""
        self.factory, self.settings, self.client_factory = factory, settings, client_factory

    def dispatch(self, publish) -> int:
        """过期租约重排，发布失败保留 outbox，绝不清除旧发布快照。"""
        now, sent = cst_now(), 0
        with self.factory() as session:
            expired = session.scalars(select(WclImport).where(WclImport.status == "importing", WclImport.lease_expires_at <= now)
                .with_for_update(skip_locked=True).limit(self.settings.list_page_limit)).all()
            for job in expired:
                job.status = "failed" if job.attempts >= self.settings.wcl_max_attempts else "pending"
                job.last_error = "WCL 导入租约已失效，可显式重试" if job.status == "failed" else "WCL 导入中断，已重新排队"
                job.lease_token, job.lease_expires_at, job.next_publish_at = None, None, now
                job.next_attempt_at = now
            rows = session.scalars(select(WclImport).where(WclImport.status == "pending", WclImport.next_publish_at <= now,
                WclImport.next_attempt_at <= now)
                .order_by(WclImport.next_publish_at).with_for_update(skip_locked=True).limit(self.settings.list_page_limit)).all()
            for job in rows:
                try:
                    publish(str(job.id))
                except Exception:
                    job.next_publish_at = now + timedelta(seconds=self.settings.processing_retry_delay_seconds)
                else:
                    job.published_at = now
                    job.next_publish_at = now + timedelta(seconds=self.settings.processing_delivery_timeout_seconds)
                    sent += 1
            session.commit()
        return sent

    def claim(self, job_id: UUID) -> WclClaim | None:
        """重新核对发起人启用状态与团队管理角色，排队不固定永久权限。"""
        with self.factory() as session:
            job = session.scalar(select(WclImport).where(WclImport.id == job_id).with_for_update())
            if not job or job.status != "pending" or job.next_attempt_at > cst_now():
                return None
            member = session.scalar(select(TeamMember).join(User, User.id == TeamMember.user_id)
                .where(TeamMember.user_id == job.requested_by, TeamMember.team_id == job.team_id, User.active.is_(True)))
            if not member or member.role not in {"leader", "analyst"}:
                job.status, job.last_error = "failed", "发起人已无团队报告导入权限"
                session.commit()
                return None
            if job.attempts >= self.settings.wcl_max_attempts or not configured(self.settings):
                job.status, job.last_error = "failed", "WCL 导入配置不可用或超过重试限制"
                session.commit()
                return None
            job.status, job.attempts = "importing", job.attempts + 1
            job.lease_token = uuid4()
            job.lease_expires_at = cst_now() + timedelta(seconds=self.settings.wcl_lease_seconds)
            job.last_error = None
            session.commit()
            return WclClaim(job.id, job.lease_token, job.team_id, job.team_pull_id, dict(job.request_json))

    def run(self, job_id: UUID):
        """分页流式写临时 JSONL，成功后一次发布；失败不替换任何旧事件。"""
        claimed = self.claim(job_id)
        if claimed is None:
            return
        client = self.client_factory(self.settings)
        try:
            deadline = time.monotonic() + self.settings.wcl_import_timeout_seconds
            code, fight_id = claimed.request["reportCode"], claimed.request["fightId"]
            report = client.report(code)
            fight, data = metadata(report, fight_id, claimed.request)
            indexes = normalization_indexes(data)
            raw_count, event_count, staged_bytes, previous_time = 0, 0, 0, None
            with tempfile.TemporaryFile(mode="w+t", encoding="utf8") as staged:
                for page in client.pages(code, fight, report["revision"], deadline):
                    for raw in page:
                        raw_count += 1
                        event = normalize(raw, code, integer(report["startTime"]), raw_count, data, indexes)
                        if event is None:
                            continue
                        event["eventId"] = f"wcl:{code}:{report['revision']}:{raw_count}"
                        # 官方页按时间顺序；乱序不默默发布为错误时间轴。
                        if previous_time is not None and event["absoluteTimeMs"] < previous_time:
                            raise WclError("WCL 关键事件时间顺序异常，未发布不完整结果")
                        previous_time = event["absoluteTimeMs"]
                        line = json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"
                        staged_bytes += len(line.encode("utf8"))
                        if staged_bytes > self.settings.wcl_max_staged_bytes:
                            raise WclError("WCL 关键事件暂存超过服务端磁盘预算，未发布不完整结果")
                        staged.write(line)
                        event_count += 1
                final = client.report(code)
                # revision 之外还比较分段及选中 fight/masterData，防止上传中报告混读。
                _, final_metadata = metadata(final, fight_id, claimed.request)
                if final["revision"] != report["revision"] or final["startTime"] != report["startTime"] or final_metadata != data:
                    raise WclError("WCL 报告版本在导入中变化，已保留旧事件", retryable=True)
                if time.monotonic() >= deadline:
                    raise WclError("WCL 导入超过整体时间限制", retryable=True)
                staged.seek(0)
                self.publish(claimed, report, data, staged, event_count, raw_count)
        except Exception as error:
            safe = str(error)[:512] if isinstance(error, WclError) else "WCL 导入发生内部异常，旧事件版本保持可用"
            self.fail(claimed, safe, isinstance(error, WclError) and error.retryable,
                error.retry_after if isinstance(error, WclError) else None)
        finally:
            client.close()

    def publish(self, claim: WclClaim, report: dict, metadata_json: dict, staged, event_count: int, raw_count: int) -> bool:
        """事件批量插入与发布指针同一事务，旧租约不能覆盖新快照。"""
        with self.factory() as session:
            # 与显式改绑采用同一锁顺序，避免 Pull／job 反向领取产生死锁。
            pull = session.scalar(select(TeamPull).where(TeamPull.team_id == claim.team_id, TeamPull.id == claim.pull_id).with_for_update())
            job = session.scalar(select(WclImport).where(WclImport.id == claim.job_id, WclImport.status == "importing",
                WclImport.lease_token == claim.lease, WclImport.lease_expires_at > cst_now()).with_for_update())
            if job is None:
                return False
            member = session.scalar(select(TeamMember).join(User, User.id == TeamMember.user_id)
                .where(TeamMember.team_id == claim.team_id, TeamMember.user_id == job.requested_by, User.active.is_(True)))
            if not member or member.role not in {"leader", "analyst"}:
                raise WclError("发起人在导入期间失去团队报告权限，旧版本保持可用")
            fight = metadata_json["fight"]
            if fight.get("encounterID") != pull.encounter_id or fight.get("difficulty") != pull.difficulty_id:
                raise WclError("WCL 战斗首领或难度与团队 Pull 不一致，拒绝错误绑定")
            ids = {UUID(binding["recordingId"]) for binding in claim.request["actorBindings"]}
            if ids and set(session.scalars(select(Recording.id).where(Recording.team_id == claim.team_id,
                    Recording.team_pull_id == claim.pull_id, Recording.id.in_(ids)))) != ids:
                raise WclError("绑定录像已离开当前团队战斗，拒绝发布")
            snapshot = WclSnapshot(id=uuid4(), team_id=claim.team_id, team_pull_id=claim.pull_id,
                report_code=claim.request["reportCode"], report_revision=report["revision"],
                report_started_at_unix_ms=integer(report["startTime"]), fight_id=claim.request["fightId"],
                metadata_json=metadata_json, event_count=event_count, raw_event_count=raw_count)
            session.add(snapshot)
            session.flush()
            batch = []
            for ordinal, line in enumerate(staged):
                event = json.loads(line)
                batch.append({"snapshot_id": snapshot.id, "ordinal": ordinal,
                    "absolute_time_ms": event["absoluteTimeMs"], "payload": event})
                if len(batch) >= self.settings.wcl_insert_batch_size:
                    session.execute(insert(WclEvent), batch)
                    batch = []
            if batch:
                session.execute(insert(WclEvent), batch)
            if job.lease_expires_at <= cst_now():
                raise WclError("WCL 发布前租约已失效，旧事件保持可用", retryable=True)
            pull.wcl_report_code, pull.wcl_fight_id, pull.association_status = snapshot.report_code, snapshot.fight_id, "wclVerified"
            # 保留共同 Pull 绝对起点，绝不只换战斗零点而遗漏视频映射。
            job.snapshot_id, job.status, job.last_error = snapshot.id, "ready", None
            job.lease_token, job.lease_expires_at = None, None
            try:
                session.commit()
            except IntegrityError:
                raise WclError("报告战斗已经关联本团队其他 Pull，旧版本保持可用") from None
            return True

    def fail(self, claim: WclClaim, message: str, retryable: bool, retry_after: int | None = None):
        """限流和网络故障延期重试，其他错误需显式修正，不暴露凭证。"""
        with self.factory() as session:
            job = session.scalar(select(WclImport).where(WclImport.id == claim.job_id,
                WclImport.lease_token == claim.lease, WclImport.status == "importing").with_for_update())
            if not job:
                return
            job.status = "pending" if retryable and job.attempts < self.settings.wcl_max_attempts else "failed"
            job.last_error = message
            job.lease_token, job.lease_expires_at = None, None
            delay = max(self.settings.processing_retry_delay_seconds, retry_after or 0)
            job.next_publish_at = cst_now() + timedelta(seconds=min(delay, self.settings.wcl_max_retry_after_seconds))
            job.next_attempt_at = job.next_publish_at
            session.commit()
