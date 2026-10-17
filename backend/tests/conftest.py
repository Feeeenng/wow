"""单元与 HTTP 测试只使用显式虚构配置，不读取或连接正式服务。"""

import os
from uuid import uuid4

import pytest

os.environ.update({
    "WOW_DATABASE_URL": "postgresql+psycopg://test:test@127.0.0.1:1/test_only",
    "WOW_S3_ENDPOINT_URL": "http://127.0.0.1:1", "WOW_S3_PUBLIC_ENDPOINT_URL": "http://127.0.0.1:19000",
    "WOW_S3_ACCESS_KEY": "test-access-only", "WOW_S3_SECRET_KEY": "test-secret-only", "WOW_S3_BUCKET": "test-videos",
})

from app.core.config import Settings
from app.schemas.recordings import RegisterRecording


@pytest.fixture
def settings():
    """真实依赖客户端只允许配合 Stubber 使用，不发出网络请求。"""
    return Settings(_env_file=None)


@pytest.fixture
def registration():
    """生成不包含用户数据的最小完整录像 manifest。"""
    return RegisterRecording(teamId=uuid4(), deviceId="test-device", localPullId="test-pull", artifactVersion="v1",
        fileSizeBytes=10, fileSha256="a" * 64, characterGuid="Player-1", characterName="测试角色",
        encounterId=1, encounterName="测试首领", difficultyId=16, encounterStartUnixMs=1000,
        encounterEndUnixMs=6000, videoZeroMs=-500, videoDurationMs=7000)
