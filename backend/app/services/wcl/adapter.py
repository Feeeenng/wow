"""WCL 官方公共 GraphQL 适配，客户端凭证只存在服务端内存。"""

import json
import time
from email.utils import parsedate_to_datetime

import httpx

from app.core.config import Settings
from app.core.errors import DomainError
from app.utils.time_utils import cst_now, normalize_to_cst

REPORT_QUERY = """query Report($code:String!){reportData{report(code:$code,allowUnlisted:false){
code visibility revision startTime endTime segments exportedSegments
fights{id encounterID difficulty startTime endTime inProgress kill size friendlyPlayers enemyPlayers
friendlyNPCs{id} friendlyPets{id} enemyNPCs{id} enemyPets{id}}
masterData{gameVersion logVersion actors{id name type subType gameID server petOwner} abilities{gameID name icon}}}}}"""
EVENTS_QUERY = """query Events($code:String!,$fight:Int!,$start:Float!,$end:Float!,$limit:Int!){reportData{
report(code:$code,allowUnlisted:false){revision events(dataType:All,fightIDs:[$fight],startTime:$start,
endTime:$end,limit:$limit,useActorIDs:true,useAbilityIDs:true){data nextPageTimestamp}}}}"""
# 仅死亡窗口读取资源，整场关键事件导入继续使用原查询，避免扩大默认带宽。
RESOURCE_EVENTS_QUERY = EVENTS_QUERY.replace("dataType:All,", "dataType:All,includeResources:true,")


def configured(settings: Settings) -> bool:
    """两个服务端凭证必须同时存在，平台个人令牌不能替代 WCL OAuth。"""
    return bool(settings.wcl_client_id and settings.wcl_client_secret
        and settings.wcl_client_id.get_secret_value() and settings.wcl_client_secret.get_secret_value())


class WclError(Exception):
    """对外安全诊断，不传播上游响应正文、令牌或请求头。"""

    def __init__(self, message: str, retryable: bool = False, retry_after: int | None = None):
        """标记限流及网络错误供持久任务延期重试。"""
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after


def retry_delay(value: str | None, settings: Settings) -> int:
    """兼容秒数和 HTTP-date，限流时间受集中上限约束，不信任任意大响应值。"""
    delay = settings.processing_retry_delay_seconds
    if value:
        try:
            delay = max(delay, int(value) if value.isdigit() else int((normalize_to_cst(parsedate_to_datetime(value)) - cst_now()).total_seconds()))
        except (ValueError, TypeError, OverflowError):
            pass
    return min(delay, settings.wcl_max_retry_after_seconds)


class WclClient:
    """固定服务端 endpoint、禁止重定向，测试可以注入真实 HTTP 协议 transport。"""

    def __init__(self, settings: Settings, transport=None):
        """每次任务复用一份短期 access token，不保存或记录令牌。"""
        self.settings = settings
        self.http = httpx.Client(timeout=settings.wcl_timeout_seconds, follow_redirects=False, transport=transport)
        self.token, self.expires = None, 0

    def close(self):
        """释放自己的 HTTP 连接，不管理外部服务进程。"""
        self.http.close()

    def _request(self, url: str, **kwargs) -> dict:
        """流式限制响应体积，上游错误只返回固定安全文字。"""
        try:
            with self.http.stream("POST", url, **kwargs) as response:
                if response.status_code == 429:
                    raise WclError("WCL 配额受限，请稍后重试", retryable=True,
                        retry_after=retry_delay(response.headers.get("Retry-After"), self.settings))
                if response.status_code in {401, 403}:
                    raise WclError("WCL 公共 API 拒绝访问，请检查服务端凭证及报告可见性")
                if response.status_code >= 500:
                    raise WclError("WCL 服务暂时不可用", retryable=True)
                if response.status_code != 200:
                    raise WclError("WCL 公共 API 请求未成功")
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > self.settings.wcl_max_response_bytes:
                        raise WclError("WCL 响应超过服务端体积限制")
                result = json.loads(data)
                if not isinstance(result, dict):
                    raise ValueError
                return result
        except (httpx.HTTPError, TimeoutError) as error:
            raise WclError("WCL 网络请求失败，请稍后重试", retryable=True) from None
        except (ValueError, UnicodeDecodeError):
            raise WclError("WCL 返回了无法解析的数据") from None

    def _token(self) -> str:
        """仅 client_credentials，可读取公共报告，不能读取私有用户报告。"""
        if not configured(self.settings):
            raise DomainError(503, "WCL 公共 API 尚未配置服务端凭证")
        if not self.token or time.monotonic() >= self.expires:
            data = self._request(self.settings.wcl_token_url,
                auth=httpx.BasicAuth(self.settings.wcl_client_id.get_secret_value(), self.settings.wcl_client_secret.get_secret_value()),
                data={"grant_type": "client_credentials"})
            token, expiry = data.get("access_token"), data.get("expires_in")
            if not isinstance(token, str) or not token or not isinstance(expiry, (int, float)) or expiry <= 0:
                raise WclError("WCL 未返回有效的公共访问令牌")
            self.token, self.expires = token, time.monotonic() + max(0, expiry - 30)
        return self.token

    def _report(self, query: str, variables: dict) -> dict:
        """GraphQL 错误可能含用户输入，不直接写日志或返回客户端。"""
        result = self._request(self.settings.wcl_api_url, json={"query": query, "variables": variables},
            headers={"Authorization": "Bearer " + self._token()})
        if result.get("errors"):
            raise WclError("WCL 查询被拒绝或报告不可用；当前仅支持公共报告")
        data = result.get("data")
        group = data.get("reportData") if isinstance(data, dict) else None
        report = group.get("report") if isinstance(group, dict) else None
        if not isinstance(report, dict):
            raise WclError("WCL 公共报告不存在或无权读取")
        return report

    def report(self, code: str) -> dict:
        """显式拒绝私有及未列出报告，不用平台身份假装已取得用户授权。"""
        report = self._report(REPORT_QUERY, {"code": code})
        if report.get("visibility") != "public":
            raise WclError("当前仅支持 WCL public 报告，private／unlisted 需要另行用户 OAuth 授权")
        if report.get("code") != code or not isinstance(report.get("revision"), int):
            raise WclError("WCL 报告身份或版本缺失")
        return report

    def pages(self, code: str, fight: dict, revision: int, deadline: float, *, include_resources: bool = False):
        """空 data 也跟随下一页，拒绝不推进、循环、超限和中途版本改变。"""
        start, end, raw_count = fight["startTime"], fight["endTime"], 0
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or end <= start:
            raise WclError("WCL 战斗时间范围无效")
        for _ in range(self.settings.wcl_max_pages):
            if time.monotonic() >= deadline:
                raise WclError("WCL 导入超过整体时间限制", retryable=True)
            report = self._report(RESOURCE_EVENTS_QUERY if include_resources else EVENTS_QUERY, {"code": code, "fight": fight["id"], "start": start,
                "end": end, "limit": self.settings.wcl_api_page_size})
            if report.get("revision") != revision:
                raise WclError("WCL 报告版本在导入中发生变化，请重新导入", retryable=True)
            page = report.get("events") or {}
            data, following = page.get("data"), page.get("nextPageTimestamp")
            if not isinstance(data, list) or any(not isinstance(event, dict) for event in data):
                raise WclError("WCL 事件页结构不受支持")
            raw_count += len(data)
            if raw_count > self.settings.wcl_max_raw_events:
                raise WclError("WCL 原始事件数量超过服务端限制，未发布不完整结果")
            yield data
            if following is None:
                return
            if not isinstance(following, (int, float)) or not start < following <= end:
                raise WclError("WCL 分页游标未推进或超出战斗范围")
            start = following
        raise WclError("WCL 分页数量超过服务端限制，未发布不完整结果")
