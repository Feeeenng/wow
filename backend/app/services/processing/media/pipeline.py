"""将经过整文件验证的本地 MP4 转成可核对时间原点的 VOD CMAF。"""

import json
import subprocess
import tempfile
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from app.core.config import MEDIA_FILENAME_PATTERN, Settings


class MediaError(Exception):
    """可展示的处理错误；内容不合法时不盲目重复昂贵媒体处理。"""

    def __init__(self, message: str, fatal: bool = False):
        """保留是否属于原片校验／格式的永久失败。"""
        super().__init__(message)
        self.fatal = fatal


@dataclass(frozen=True)
class MediaArtifact:
    """已完整解码和包锚点验证的本地发布产物。"""

    directory: Path
    duration_ms: int
    shift_ms: int
    files: list[Path]


class MediaProcessor:
    """所有命令使用参数数组，只接受服务端生成的临时本地路径。"""

    def __init__(self, settings: Settings, deadline: float):
        """全流程共享单调时钟截止时间，严格小于数据库任务租约。"""
        self.settings, self.deadline = settings, deadline

    def remaining(self) -> float:
        """每个外部调用都消耗同一个整体预算，而非无限重置超时。"""
        seconds = self.deadline - time.monotonic()
        if seconds <= 0:
            raise MediaError("媒体处理超过整体时限")
        return seconds

    def _run(self, executable: str, args: list[str], capture: bool = False, cwd: Path | None = None) -> bytes:
        """隔离标准输入并限制输出体积，失败诊断不包含凭证或外部 URL。"""
        try:
            with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
                result = subprocess.run([executable, *args], stdin=subprocess.DEVNULL, stdout=output,
                                        stderr=errors, timeout=self.remaining(), check=False, cwd=cwd)
                if result.returncode:
                    raise MediaError(f"媒体程序处理失败，退出码 {result.returncode}")
                if capture:
                    if output.tell() > self.settings.media_probe_max_bytes:
                        raise MediaError("媒体探测输出超出限制", fatal=True)
                    output.seek(0)
                    return output.read()
                return b""
        except FileNotFoundError:
            raise MediaError("未找到配置的 FFmpeg 或 ffprobe 程序") from None
        except subprocess.TimeoutExpired:
            raise MediaError("媒体程序超过整体处理时限") from None

    def probe(self, path: Path, kind: str) -> dict:
        """强制识别 MOV 或本机 HLS，禁止输入伪装成远程播放清单。"""
        raw = self._run(self.settings.ffprobe_path, ["-v", "error", "-protocol_whitelist", "file,crypto",
            "-f", kind, "-read_intervals", f"%+#{self.settings.media_probe_packet_limit}",
            "-show_packets", "-show_streams", "-show_format", "-show_data_hash", "sha256",
            "-show_entries", "packet=stream_index,pts_time,data_hash:stream=index,codec_type,codec_name,start_time:format=duration,start_time",
            "-of", "json", str(path)], capture=True)
        try:
            return json.loads(raw)
        except (ValueError, UnicodeError):
            raise MediaError("媒体探测返回无效结构", fatal=True) from None

    @staticmethod
    def _video_packets(probe: dict) -> list[tuple[str, int]]:
        """只比较首视频轨的压缩包，音频预留时间不能冒充画面锚点。"""
        video = next((stream for stream in probe.get("streams", []) if stream.get("codec_type") == "video"), None)
        if video is None:
            raise MediaError("录像没有可播放视频轨", fatal=True)
        packets = []
        for packet in probe.get("packets", []):
            if packet.get("stream_index") == video["index"] and packet.get("data_hash") and "pts_time" in packet:
                packets.append((packet["data_hash"], round(float(packet["pts_time"]) * 1000)))
        return packets

    @classmethod
    def _shift(cls, source: dict, published: dict) -> int:
        """用同一压缩视频包关联输入输出 PTS，不用容器预计时长猜偏移。"""
        before, after = cls._video_packets(source), cls._video_packets(published)
        before_counts, after_counts = Counter(key for key, _ in before), Counter(key for key, _ in after)
        positions = {key: pts for key, pts in before if before_counts[key] == 1}
        votes = Counter(pts - positions[key] for key, pts in after if after_counts[key] == 1 and key in positions)
        if not votes:
            raise MediaError("无法验证 HLS 首段视频包时间映射", fatal=True)
        return sorted(votes, key=lambda delta: (-votes[delta], abs(delta)))[0]

    def prepare(self, source: Path, directory: Path) -> MediaArtifact:
        """当前发布 H.264／AAC 主轨，原片及全部原音轨仍完整保留在私有对象中。"""
        source, directory = source.resolve(), directory.resolve()
        directory.mkdir(parents=True, exist_ok=True)
        original = self.probe(source, "mov")
        videos = [stream for stream in original.get("streams", []) if stream.get("codec_type") == "video"]
        audios = [stream for stream in original.get("streams", []) if stream.get("codec_type") == "audio"]
        if not videos or videos[0].get("codec_name") != "h264" or audios and audios[0].get("codec_name") != "aac":
            raise MediaError("当前云端 CMAF 处理支持 H.264 视频和 AAC 主音轨，请调整录制编码", fatal=True)
        playlist = directory / "index.m3u8"
        self._run(self.settings.ffmpeg_path, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-protocol_whitelist", "file,crypto", "-f", "mov", "-i", str(source),
            "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero",
            "-f", "hls", "-hls_segment_type", "fmp4", "-hls_time", str(self.settings.hls_segment_seconds),
            "-hls_playlist_type", "vod", "-hls_list_size", "0", "-hls_flags", "independent_segments",
            "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", "segment-%05d.m4s", "index.m3u8"], cwd=directory)
        if "#EXT-X-ENDLIST" not in playlist.read_text(encoding="utf-8"):
            raise MediaError("输出清单不是完整 VOD", fatal=True)
        if playlist.stat().st_size > self.settings.media_probe_max_bytes or not (directory / "init.mp4").is_file():
            raise MediaError("输出清单体积异常或缺少初始化段", fatal=True)
        files = sorted(directory.iterdir())
        import re
        if any(not re.fullmatch(MEDIA_FILENAME_PATTERN, path.name) or path.stat().st_size > self.settings.processing_max_segment_bytes for path in files):
            raise MediaError("输出媒体名称或分片大小超出发布限制", fatal=True)
        # 实际解码所有发布的主视频／音频，不以 ffprobe 成功代替媒体校验。
        self._run(self.settings.ffmpeg_path, ["-hide_banner", "-loglevel", "error", "-nostdin", "-xerror",
            "-protocol_whitelist", "file,crypto", "-i", str(playlist), "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"])
        published = self.probe(playlist, "hls")
        try:
            duration = round(float(published["format"]["duration"]) * 1000)
        except (KeyError, ValueError, TypeError):
            raise MediaError("发布媒体缺少有效时长", fatal=True) from None
        if duration <= 0:
            raise MediaError("发布媒体时长无效", fatal=True)
        return MediaArtifact(directory, duration, self._shift(original, published), files)


def published_manifest(original: dict, artifact: MediaArtifact) -> dict:
    """PTS 平移与原有缺片区间同时迁移，不覆盖客户端的采集时钟警告。"""
    result = {**original, "videoZeroMs": original["videoZeroMs"] + artifact.shift_ms,
              "videoDurationMs": artifact.duration_ms, "publicationShiftMs": artifact.shift_ms}
    intervals = []
    for interval in original.get("intervals", []):
        start, end = interval["videoStartMs"] + artifact.shift_ms, interval["videoEndMs"] + artifact.shift_ms
        clipped_start, clipped_end = max(0, start), min(artifact.duration_ms, end)
        if clipped_end <= clipped_start:
            continue
        ratio = (interval["pullEndMs"] - interval["pullStartMs"]) / (end - start)
        intervals.append({"videoStartMs": clipped_start, "videoEndMs": clipped_end,
            "pullStartMs": interval["pullStartMs"] + round((clipped_start - start) * ratio),
            "pullEndMs": interval["pullEndMs"] - round((end - clipped_end) * ratio)})
    result["intervals"] = intervals
    return result
