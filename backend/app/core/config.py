"""集中声明后端连接、鉴权、上传及媒体访问限制。"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 发布和代理共同使用的固定文件契约，不能由客户端扩展白名单。
MEDIA_FILENAME_PATTERN = r"index\.m3u8|init\.mp4|segment-\d{5}\.m4s"


class Settings(BaseSettings):
    """只从环境读取部署配置，不提供真实凭证或本地数据库替代。"""

    model_config = SettingsConfigDict(env_prefix="WOW_", env_file=Path(__file__).resolve().parents[3] / ".env", extra="ignore", hide_input_in_errors=True)
    database_url: SecretStr
    s3_endpoint_url: str
    s3_public_endpoint_url: str
    s3_access_key: SecretStr
    s3_secret_key: SecretStr
    s3_bucket: str
    # S3 签名区域及路径模式同时适用于 AWS 与本机 MinIO。
    s3_region: str = "us-east-1"
    s3_addressing_style: Literal["path", "virtual"] = "path"
    # 一次视频上传最多 50GiB；分片大小必须满足 S3 非末片下限。
    max_video_bytes: int = Field(default=50 * 1024**3, ge=1)
    multipart_part_size_bytes: int = Field(default=64 * 1024**2, ge=5 * 1024**2, le=64 * 1024**2)
    max_upload_parts: int = Field(default=10_000, ge=1, le=10_000)
    upload_url_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    # 私有媒体签名短期有效，禁止用公开桶替代团队授权。
    playback_url_ttl_seconds: int = Field(default=300, ge=30, le=3600)
    playback_grant_max_chars: int = Field(default=2048, ge=256, le=4096)
    s3_connect_timeout_seconds: int = Field(default=5, ge=1, le=30)
    s3_read_timeout_seconds: int = Field(default=30, ge=1, le=120)
    s3_retry_attempts: int = Field(default=2, ge=1, le=5)
    # 操作者显式签发的个人令牌有效期，不创建默认身份。
    api_token_days: int = Field(default=30, ge=1, le=90)
    api_token_prefix: str = "wow_"
    max_manifest_players: int = Field(default=40, ge=1, le=100)
    max_mapping_intervals: int = Field(default=1000, ge=1, le=5000)
    max_pull_duration_ms: int = Field(default=24 * 60 * 60 * 1000, ge=1)
    list_page_limit: int = Field(default=100, ge=1, le=500)
    object_prefix: str = "teams"
    # JSON manifest 的输入体积上限，不用于代理视频内容。
    max_request_bytes: int = Field(default=2 * 1024 * 1024, ge=1024, le=10 * 1024 * 1024)
    # PG 保留任务真值；Redis 只传递可重复投递的任务 ID。
    redis_url: SecretStr | None = None
    public_api_url: str = "http://127.0.0.1:18000"
    playback_signing_key: SecretStr | None = Field(default=None, min_length=32)
    # 媒体程序必须由部署提供，不自动下载或执行客户端指定程序。
    ffmpeg_path: str = "ffmpeg"
    ffprobe_path: str = "ffprobe"
    processing_temp_directory: str | None = None
    processing_timeout_seconds: int = Field(default=1800, ge=10, le=86_400)
    processing_lease_seconds: int = Field(default=3600, ge=120, le=172_800)
    processing_max_attempts: int = Field(default=3, ge=1, le=10)
    processing_dispatch_interval_seconds: int = Field(default=10, ge=1, le=60)
    processing_delivery_timeout_seconds: int = Field(default=120, ge=30, le=3600)
    processing_retry_delay_seconds: int = Field(default=30, ge=1, le=3600)
    # 队列及 Redis key 共用独立命名空间，隔离联调不能消费其他服务的任务。
    processing_queue: str = Field(default="wow-media", pattern=r"^[A-Za-z0-9_-]{1,80}$")
    processing_max_segment_bytes: int = Field(default=64 * 1024**2, ge=1024, le=1024**3)
    processing_disk_reserve_bytes: int = Field(default=512 * 1024**2, ge=0)
    # HLS 片长由关键帧影响，仍需媒体包锚点验证输出时间偏移。
    hls_segment_seconds: int = Field(default=4, ge=1, le=10)
    media_probe_packet_limit: int = Field(default=128, ge=3, le=1000)
    media_probe_max_bytes: int = Field(default=2 * 1024**2, ge=1024)
    media_stream_chunk_bytes: int = Field(default=256 * 1024, ge=1024, le=1024**2)
    # 仅允许明确的桌面及开发来源，私有媒体不使用通配 CORS。
    cors_origins: list[str] = ["http://tauri.localhost", "tauri://localhost", "http://localhost:1420", "http://127.0.0.1:1420"]
    # WCL 仅使用服务端公共 client credentials；空配置明确禁用，不支持私有用户报告。
    wcl_client_id: SecretStr | None = None
    wcl_client_secret: SecretStr | None = None
    wcl_token_url: str = "https://www.warcraftlogs.com/oauth/token"
    wcl_api_url: str = "https://www.warcraftlogs.com/api/v2/client"
    wcl_timeout_seconds: int = Field(default=30, ge=1, le=120)
    wcl_import_timeout_seconds: int = Field(default=600, ge=30, le=1200)
    wcl_lease_seconds: int = Field(default=1200, ge=120, le=1800)
    # 防止异常分页耗尽 API 配额、内存或磁盘，超限不发布不完整快照。
    wcl_max_pages: int = Field(default=2000, ge=1, le=10_000)
    wcl_max_raw_events: int = Field(default=2_000_000, ge=1, le=10_000_000)
    wcl_max_response_bytes: int = Field(default=16 * 1024**2, ge=1024, le=64 * 1024**2)
    wcl_max_staged_bytes: int = Field(default=512 * 1024**2, ge=1024, le=2 * 1024**3)
    wcl_event_page_limit: int = Field(default=1000, ge=1, le=1000)
    wcl_event_page_default: int = Field(default=500, ge=1, le=1000)
    wcl_api_page_size: int = Field(default=10_000, ge=1, le=10_000)
    wcl_insert_batch_size: int = Field(default=1000, ge=1, le=5000)
    wcl_max_attempts: int = Field(default=3, ge=1, le=5)
    # 限流 Retry-After 以 PG 延期处理，既不忙循环也不无限阻塞 worker。
    wcl_max_retry_after_seconds: int = Field(default=3600, ge=60, le=86_400)
    # 团队死亡窗口按需读取WCL；缓存只是短期快照，权限及已发布版本每页重新检查。
    death_review_window_ms: int = Field(default=15_000, ge=1000, le=60_000)
    death_review_max_rows: int = Field(default=5000, ge=1, le=5000)
    death_review_prior_aura_limit: int = Field(default=2000, ge=1, le=2000)
    death_review_page_limit: int = Field(default=250, ge=1, le=250)
    death_review_cache_ttl_seconds: int = Field(default=120, ge=1, le=600)
    # Redis故障时短等待后重新读取WCL，不把缓存当来源真值。
    death_review_cache_timeout_seconds: float = Field(default=0.5, ge=0.05, le=5)
    death_review_max_bytes: int = Field(default=8 * 1024**2, ge=1024, le=16 * 1024**2)
    death_review_timeout_seconds: int = Field(default=20, ge=1, le=60)
    # 单次WCL请求较短，整体窗口预算之外只允许最后一次来源复核等待。
    death_review_http_timeout_seconds: int = Field(default=5, ge=1, le=10)
    # 视频画笔按归一化内容坐标保存；限制单份快照的绘制与文本负载。
    annotation_max_items: int = Field(default=200, ge=1, le=1000)
    annotation_max_points_per_item: int = Field(default=512, ge=2, le=5000)
    annotation_max_total_points: int = Field(default=20_000, ge=2, le=100_000)
    annotation_max_text_chars: int = Field(default=500, ge=1, le=5000)
    annotation_min_duration_ms: int = Field(default=1, ge=1, le=60_000)
    annotation_max_duration_ms: int = Field(default=60_000, ge=1, le=3_600_000)
    annotation_min_width: float = Field(default=1, ge=1, le=12)
    annotation_max_width: float = Field(default=12, ge=1, le=12)
    # 团队共享校准只允许有界的毫秒偏移，不改变原媒体与战斗时间事实。
    shared_calibration_max_offset_ms: int = Field(default=300_000, ge=1, le=3_600_000)

    @field_validator("database_url")
    @classmethod
    def require_postgresql(cls, value: SecretStr) -> SecretStr:
        """只允许项目约定的 PostgreSQL 驱动，禁止静默改成 SQLite。"""
        if not value.get_secret_value().startswith("postgresql+psycopg://"):
            raise ValueError("数据库必须使用 postgresql+psycopg")
        return value

    @field_validator("s3_endpoint_url", "s3_public_endpoint_url", "public_api_url")
    @classmethod
    def require_http_endpoint(cls, value: str) -> str:
        """对象存储地址由部署者配置，不接受请求内任意 endpoint。"""
        from urllib.parse import urlsplit
        url = urlsplit(value)
        if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
            raise ValueError("S3 endpoint 必须为不带凭证及路径的 HTTP 地址")
        return value.rstrip("/")

    @field_validator("wcl_token_url", "wcl_api_url")
    @classmethod
    def require_wcl_endpoint(cls, value: str) -> str:
        """WCL 凭证只通过 HTTPS，HTTP 仅用于显式 loopback 协议验证。"""
        from urllib.parse import urlsplit
        url = urlsplit(value)
        secure = url.scheme == "https" or (url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost", "::1"})
        if not secure or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("WCL endpoint 必须是无内嵌凭证的 HTTPS 地址或 loopback 测试地址")
        return value

    @field_validator("s3_bucket", "object_prefix")
    @classmethod
    def require_safe_storage_name(cls, value: str) -> str:
        """桶和对象前缀只允许固定安全字符。"""
        import re
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", value) or ".." in value:
            raise ValueError("对象存储名称无效")
        return value

    @model_validator(mode="after")
    def lease_covers_processing_deadline(self):
        """整体处理超时加网络重试余量必须小于租约，健康任务不会被提前重领。"""
        budget = (self.s3_connect_timeout_seconds + self.s3_read_timeout_seconds) * (self.s3_retry_attempts + 1) * 2
        if self.processing_lease_seconds <= self.processing_timeout_seconds + budget:
            raise ValueError("处理租约必须覆盖整体超时及存储重试预算")
        if self.wcl_lease_seconds <= self.wcl_import_timeout_seconds + self.wcl_timeout_seconds * 2:
            raise ValueError("WCL 租约必须覆盖导入超时及请求余量")
        return self

    @model_validator(mode="after")
    def annotation_limits_are_ordered(self):
        """画笔部署限制必须形成有效区间，不能出现全部请求必定失败的配置。"""
        if self.annotation_min_duration_ms > self.annotation_max_duration_ms or self.annotation_min_width > self.annotation_max_width:
            raise ValueError("视频标记的最小限制不能超过最大限制")
        return self


@lru_cache
def get_settings() -> Settings:
    """每个进程只解析一次部署配置。"""
    return Settings()
