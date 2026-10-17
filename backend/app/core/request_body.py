"""对普通和分块编码的 JSON 请求施加同一体积上限。"""

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse


class RequestBodyLimit:
    """视频直传 S3；API 不应接收无界媒体或原始日志正文。"""

    def __init__(self, app, maximum: int):
        """保存显式配置的最大请求体。"""
        self.app, self.maximum = app, maximum

    async def __call__(self, scope, receive, send):
        """累计真实接收字节，不能仅相信 Content-Length。"""
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        length = dict(scope.get("headers", [])).get(b"content-length")
        if length and length.isdigit() and int(length) > self.maximum:
            return await JSONResponse({"detail": "请求体超过限制"}, status_code=413)(scope, receive, send)
        received = 0

        async def limited_receive():
            """所有分块共享累计限制。"""
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > self.maximum:
                raise HTTPException(413, "请求体超过限制")
            return message

        return await self.app(scope, limited_receive, send)
