"""Celery 任务入口，队列中只包含任务 UUID，永久状态以 PostgreSQL 为准。"""

from uuid import UUID

from celery import Celery

from app.core.config import get_settings
from app.db.session import session_factory
# worker 是独立入口，显式注册全部模型，避免媒体事务缺少身份表外键目标。
from app.models import annotations, identity, processing, recordings, uploads, wcl
from app.services.processing.jobs import ProcessingService
from app.services.uploads.storage import S3Storage
from app.services.wcl.importing.jobs import WclJobService

settings = get_settings()
if settings.redis_url is None:
    raise RuntimeError("媒体 worker 需要显式配置 WOW_REDIS_URL")

celery_app = Celery("wow", broker=settings.redis_url.get_secret_value())
celery_app.conf.update(task_serializer="json", accept_content=["json"], result_backend=None,
    task_ignore_result=True, task_acks_late=True, task_reject_on_worker_lost=True, worker_prefetch_multiplier=1,
    task_default_queue=settings.processing_queue,
    broker_transport_options={"global_keyprefix": f"{settings.processing_queue}:", "visibility_timeout": settings.processing_lease_seconds},
    broker_connection_retry_on_startup=True, broker_connection_timeout=settings.s3_connect_timeout_seconds,
    task_time_limit=settings.processing_timeout_seconds + (settings.s3_connect_timeout_seconds + settings.s3_read_timeout_seconds) * (settings.s3_retry_attempts + 1),
    timezone="Asia/Shanghai", enable_utc=False,
    beat_schedule={"processing-outbox": {"task": "wow.dispatch_processing", "schedule": settings.processing_dispatch_interval_seconds},
        "wcl-outbox": {"task": "wow.dispatch_wcl", "schedule": settings.processing_dispatch_interval_seconds}})


@celery_app.task(name="wow.dispatch_processing")
def dispatch_processing():
    """broker 恢复后重新派发 PG 中尚未完成的任务，不依赖消息永久保留。"""
    storage = S3Storage(settings)
    try:
        service = ProcessingService(session_factory(), settings, storage)
        return service.dispatch(lambda job_id: celery_app.send_task("wow.process_recording", args=[job_id], retry=False))
    finally:
        storage.close()


@celery_app.task(name="wow.process_recording")
def process_recording(job_id: str):
    """拒绝任意文件路径与命令参数，只处理数据库中上传完成的录像。"""
    try:
        identifier = UUID(job_id)
    except ValueError:
        return
    storage = S3Storage(settings)
    try:
        ProcessingService(session_factory(), settings, storage).run(identifier)
    finally:
        storage.close()


@celery_app.task(name="wow.dispatch_wcl")
def dispatch_wcl():
    """公共事件导入使用独立持久任务事实，消息丢失后可重新投递。"""
    return WclJobService(session_factory(), settings).dispatch(
        lambda job_id: celery_app.send_task("wow.import_wcl", args=[job_id], retry=False))


# WCL 请求预算独立于媒体处理；Settings 保证该硬超时严格小于 WCL 租约。
@celery_app.task(name="wow.import_wcl", time_limit=settings.wcl_import_timeout_seconds + 2 * settings.wcl_timeout_seconds)
def import_wcl(job_id: str):
    """队列只接受任务 UUID，不能接受任意 endpoint 或 WCL 凭证。"""
    try:
        identifier = UUID(job_id)
    except ValueError:
        return
    WclJobService(session_factory(), settings).run(identifier)
