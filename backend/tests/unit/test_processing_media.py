"""使用本机已有 FFmpeg 的合成媒体验证，不外发用户录像。"""

import hashlib
import io
import os
import shutil
import subprocess
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from botocore.response import StreamingBody

from app.services.processing.media.assets import AssetStager
from app.services.processing.media.pipeline import MediaError, MediaProcessor, published_manifest


@pytest.fixture
def media_tools(settings):
    """优先使用系统程序，Windows 验证可使用项目已经校验的固定运行时。"""
    root = Path(__file__).resolve().parents[3]
    ffmpeg = shutil.which("ffmpeg") or (root / "client/src-tauri/resources/ffmpeg-runtime/bin/ffmpeg.exe" if os.name == "nt" else None)
    ffprobe = shutil.which("ffprobe") or (root / "client/src-tauri/resources/ffmpeg-runtime/probe/bin/ffprobe.exe" if os.name == "nt" else None)
    if not ffmpeg or not ffprobe or not Path(ffmpeg).is_file() or not Path(ffprobe).is_file():
        pytest.skip("未提供可执行的 FFmpeg／ffprobe，未声称媒体验证完成")
    return settings.model_copy(update={"ffmpeg_path": str(ffmpeg), "ffprobe_path": str(ffprobe)})


def test_full_file_sha_rejects_corrupt_source_before_media(tmp_path, settings):
    """对象长度相同但内容变化仍必须被完整 SHA-256 发现。"""
    storage = MagicMock()
    storage._call.return_value = {"ContentLength": 5, "Body": StreamingBody(io.BytesIO(b"wrong"), 5)}
    stager = AssetStager(storage, settings, time.monotonic() + 30)
    with pytest.raises(MediaError) as error:
        stager.download("private-source", tmp_path / "source.mp4", 5, hashlib.sha256(b"right").hexdigest())
    assert error.value.fatal


def test_synthetic_h264_aac_vod_has_matching_decoded_frame_and_private_publish(tmp_path, media_tools):
    """真实生成、CMAF 处理、完整解码和对应帧 SHA；存储上传边界使用替身。"""
    source = tmp_path / "source.mp4"
    available = subprocess.run([media_tools.ffmpeg_path, "-hide_banner", "-encoders"], capture_output=True, check=True).stdout.decode()
    encoder = "libx264" if "libx264" in available else "libopenh264"
    subprocess.run([media_tools.ffmpeg_path, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
        "-t", "7", "-c:v", encoder, "-g", "25", "-c:a", "aac", str(source)], check=True, capture_output=True, timeout=30)
    processor = MediaProcessor(media_tools, time.monotonic() + 60)
    artifact = processor.prepare(source, tmp_path / "hls")
    assert artifact.duration_ms >= 6900
    assert len(list(artifact.directory.glob("segment-*.m4s"))) >= 2
    assert {"init.mp4", "index.m3u8"}.issubset({file.name for file in artifact.files})
    assert all(file.name.startswith(("init", "index", "segment-")) for file in artifact.files)

    def frame_hash(path, second):
        """解码 rawvideo 的对应可见帧，避免只比较数字 PTS。"""
        result = subprocess.run([media_tools.ffmpeg_path, "-hide_banner", "-loglevel", "error", "-copyts",
            "-i", str(path), "-vf", f"select=gte(t\\,{second})", "-map", "0:v:0", "-an", "-frames:v", "1",
            "-c:v", "rawvideo", "-pix_fmt", "yuv420p", "-f", "hash", "-hash", "sha256", "-"],
            check=True, capture_output=True, timeout=30)
        return result.stdout.strip()

    assert frame_hash(source, 0.8) == frame_hash(artifact.directory / "index.m3u8", 0.8 + artifact.shift_ms / 1000)
    assert frame_hash(source, 4.8) == frame_hash(artifact.directory / "index.m3u8", 4.8 + artifact.shift_ms / 1000)
    manifest = published_manifest({"videoZeroMs": 400, "clockDiscontinuous": True,
        "intervals": [{"pullStartMs": 0, "pullEndMs": 2000, "videoStartMs": 400, "videoEndMs": 2400}]}, artifact)
    assert manifest["clockDiscontinuous"] is True
    assert manifest["videoZeroMs"] == 400 + artifact.shift_ms
    storage = MagicMock()
    AssetStager(storage, media_tools, time.monotonic() + 30).publish("server-owned-version", artifact)
    calls = storage._call.call_args_list
    assert calls[-1].kwargs["Key"].endswith("index.m3u8")
    assert all(call.kwargs["Key"].startswith("server-owned-version/") for call in calls)
    assert all("ChecksumSHA256" in call.kwargs for call in calls)
