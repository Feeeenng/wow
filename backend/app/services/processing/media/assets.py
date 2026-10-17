"""私有原片校验与分版本媒体发布。"""

import hashlib
import time
from pathlib import Path

from app.core.config import Settings
from app.services.processing.media.pipeline import MediaArtifact, MediaError
from app.services.uploads.storage import S3Storage
from app.services.uploads.validation import checksum_base64


class AssetStager:
    """只有整文件 SHA-256 相同的原片才能进入媒体发布。"""

    def __init__(self, storage: S3Storage, settings: Settings, deadline: float):
        """使用同一整体截止时间约束下载、处理和上传。"""
        self.storage, self.settings, self.deadline = storage, settings, deadline

    def _check(self):
        """流式传输每一块后检查整体时限，不能无限延长任务租约。"""
        if time.monotonic() >= self.deadline:
            raise MediaError("媒体传输超过整体处理时限")

    def download(self, key: str, path: Path, expected_size: int, expected_sha: str):
        """原片只写受限临时路径，读取异常不保留一个假完整文件。"""
        result = self.storage._call("get_object", Key=key)
        if result.get("ContentLength") != expected_size:
            result["Body"].close()
            raise MediaError("原片对象大小与登记值不一致", fatal=True)
        digest, received = hashlib.sha256(), 0
        try:
            with path.open("wb") as output:
                for chunk in result["Body"].iter_chunks(self.settings.media_stream_chunk_bytes):
                    self._check()
                    received += len(chunk)
                    if received > expected_size:
                        raise MediaError("原片对象超过声明大小", fatal=True)
                    digest.update(chunk)
                    output.write(chunk)
        finally:
            result["Body"].close()
        if received != expected_size or digest.hexdigest() != expected_sha:
            raise MediaError("原片整文件 SHA-256 或大小验证失败", fatal=True)

    def publish(self, prefix: str, artifact: MediaArtifact):
        """分片和初始化段先写入，完整清单最后写；DB ready 是最终发布门槛。"""
        ordered = sorted(artifact.files, key=lambda path: path.name == "index.m3u8")
        for path in ordered:
            self._check()
            data = path.read_bytes()
            content_type = "application/vnd.apple.mpegurl" if path.suffix == ".m3u8" else "video/mp4"
            self.storage._call("put_object", Key=f"{prefix}/{path.name}", Body=data, ContentType=content_type,
                               ContentLength=len(data), ChecksumSHA256=checksum_base64(hashlib.sha256(data).hexdigest()))
        self._check()
