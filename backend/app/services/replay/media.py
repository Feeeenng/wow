"""私有 HLS 媒体访问与清单授权传播。"""

import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select

from app.core.config import MEDIA_FILENAME_PATTERN, Settings
from app.core.errors import DomainError
from app.models.identity import TeamMember, User
from app.models.recordings import Recording
from app.services.identity.access import Principal
from app.services.replay.grants import PlaybackGrants
from app.services.uploads.storage import S3Storage


def valid_media_name(name: str) -> bool:
    """只开放本项目生成的 CMAF 固定文件，不接受路径、URL 或编码穿越。"""
    return bool(re.fullmatch(MEDIA_FILENAME_PATTERN, name))


def authorized_playlist(text: str, grant: str | None) -> str:
    """Grant 清单对子片和初始化 URI 传播授权；Bearer 清单保留相对路径。"""
    lines = []
    suffix = f"?grant={grant}" if grant else ""
    for line in text.splitlines():
        if line and not line.startswith("#"):
            if not valid_media_name(line) or line == "index.m3u8":
                raise DomainError(503, "已发布清单包含不受支持的媒体引用")
            line += suffix
        elif line.startswith("#EXT-X-MAP:"):
            match = re.search(r'URI="([^"]+)"', line)
            if not match or match[1] != "init.mp4":
                raise DomainError(503, "已发布清单的初始化引用无效")
            line = line[:match.start(1)] + match[1] + suffix + line[match.end(1):]
        elif line.startswith(("#EXT-X-KEY:", "#EXT-X-SESSION-KEY:")):
            raise DomainError(503, "已发布清单不能包含外部密钥引用")
        lines.append(line)
    return "\n".join(lines) + "\n"


@dataclass
class MediaResponse:
    """路由仅负责将受控领域响应写到 HTTP，不读取 S3 或判断权限。"""

    body: object
    media_type: str
    headers: dict
    status_code: int
    streaming: bool


class ReplayMediaService:
    """每次请求重新检查当前账号和团队，不把短期 grant 当永久会员身份。"""

    def __init__(self, session, settings: Settings, storage: S3Storage, principal: Principal | None):
        """Bearer 与 grant 共用受控资源查询。"""
        self.session, self.settings, self.storage, self.principal = session, settings, storage, principal

    def open(self, team_id: UUID, recording_id: UUID, filename: str, grant: str | None, version: UUID | None,
             range_value: str | None) -> MediaResponse:
        """只向获准用户提供当前版本媒体，旧版本返回 410 避免混片。"""
        if not valid_media_name(filename):
            raise DomainError(404, "不支持的媒体文件")
        claims = PlaybackGrants(self.settings).verify(grant, team_id, recording_id) if grant else None
        if self.principal is None and claims is None:
            raise DomainError(401, "请提供有效账号或播放授权")
        viewer_id = self.principal.user_id if self.principal else claims["u"]
        if claims and viewer_id != claims["u"]:
            raise DomainError(401, "播放授权与当前账号不一致")
        recording = self.session.scalar(select(Recording)
            .join(TeamMember, TeamMember.team_id == Recording.team_id).join(User, User.id == TeamMember.user_id)
            .where(TeamMember.user_id == viewer_id, User.active.is_(True))
            .where(Recording.team_id == team_id, Recording.id == recording_id))
        if not recording:
            raise DomainError(404, "录像不存在或当前账号无权查看")
        expected = claims["v"] if claims else version
        if claims and version is not None and version != expected:
            raise DomainError(410, "播放授权与请求产物版本不一致")
        if expected is not None and expected != recording.playback_version:
            raise DomainError(410, "回放产物版本已变化，请重新加载")
        if recording.status != "ready" or recording.playback_version is None:
            raise DomainError(409, "录像尚未处理完成")
        prefix = f"{self.settings.object_prefix}/{team_id}/recordings/{recording_id}/playback/{recording.playback_version}"
        if recording.playback_key != f"{prefix}/index.m3u8":
            raise DomainError(503, "录像发布路径与当前版本不一致")
        params = {"Key": f"{prefix}/{filename}"}
        if filename != "index.m3u8" and range_value:
            if not re.fullmatch(r"bytes=(?:\d+-\d*|-\d+)", range_value):
                raise DomainError(416, "媒体范围请求无效")
            params["Range"] = range_value
        result = self.storage._call("get_object", **params)
        headers = {"Cache-Control": "private, no-store", "Accept-Ranges": "bytes"}
        if filename == "index.m3u8":
            try:
                raw = result["Body"].read(self.settings.media_probe_max_bytes + 1)
            finally:
                result["Body"].close()
            if len(raw) > self.settings.media_probe_max_bytes:
                raise DomainError(503, "回放清单体积异常")
            try:
                body = authorized_playlist(raw.decode("utf-8"), grant)
            except UnicodeError:
                raise DomainError(503, "回放清单编码无效") from None
            return MediaResponse(body, "application/vnd.apple.mpegurl", headers, 200, False)
        if result.get("ContentRange"):
            headers["Content-Range"] = result["ContentRange"]
        headers["Content-Length"] = str(result["ContentLength"])

        def chunks():
            """响应结束或客户端断开后关闭存储连接，不把整段读进 API 内存。"""
            try:
                yield from result["Body"].iter_chunks(self.settings.media_stream_chunk_bytes)
            finally:
                result["Body"].close()

        return MediaResponse(chunks(), "video/mp4", headers, 206 if "ContentRange" in result else 200, True)
