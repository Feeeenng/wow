"""统一使用中国标准时间处理业务时间。"""

from datetime import datetime
from zoneinfo import ZoneInfo

CST = ZoneInfo("Asia/Shanghai")


def cst_now() -> datetime:
    """生成带 Asia/Shanghai 时区的当前业务时间。"""
    return datetime.now(CST)


def normalize_to_cst(value: datetime) -> datetime:
    """历史无时区值按项目中国标准时间解释。"""
    return value.replace(tzinfo=CST) if value.tzinfo is None else value.astimezone(CST)


def serialize_cst_datetime(value: datetime | None) -> str | None:
    """管理接口统一输出中国标准时间，不要求前端二次换算。"""
    return normalize_to_cst(value).strftime("%Y-%m-%d %H:%M:%S") if value else None
