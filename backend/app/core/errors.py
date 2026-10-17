"""领域错误与 HTTP 状态的明确契约。"""


class DomainError(Exception):
    """携带可公开的简短诊断，不传播数据库连接串或存储凭证。"""

    def __init__(self, status_code: int, detail: str, code: str | None = None):
        """保存业务状态，外部异常由各协议边界转换。"""
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.code = code
