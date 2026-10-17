import { API_PREFIX, API_ROOT, API_TIMEOUT_MS, MAX_API_RESPONSE_BYTES } from "@/config";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

/** 所有凭证只发送到部署指定的API根，不从链接接受服务器地址。 */
function apiOrigin() {
  const url = new URL(API_ROOT);
  if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)
    || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) {
    throw new Error("复盘服务地址无效，请联系站点管理员。");
  }
  return url.origin;
}

const errors: Record<number, string> = {
  401: "身份验证已失效，请重新登录。",
  403: "当前账号没有此操作的团队权限。",
  404: "团队或录像不存在，或当前账号无法访问。",
  409: "数据或录像版本已变化，请读取最新内容后复核。",
  422: "输入超出允许范围，或没有可用的战斗画面。",
  503: "复盘服务暂不可用，请稍后重试。",
};

async function boundedJson(response: Response) {
  if (Number(response.headers.get("Content-Length")) > MAX_API_RESPONSE_BYTES) throw new Error("服务响应超过允许大小。");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("服务返回空响应。");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_API_RESPONSE_BYTES) { await reader.cancel(); throw new Error("服务响应超过允许大小。"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("服务响应格式无效。"); }
}

/** 页面内存会话拥有所有请求；退出立即终止请求，不落盘令牌。 */
export class WebApi {
  private origin = apiOrigin();
  private controller = new AbortController();
  private alive = true;
  constructor(private token: string, private unauthorized: () => void) {}

  close() { this.alive = false; this.token = ""; this.controller.abort(); }

  async request<T>(route: string, method = "GET", body?: unknown): Promise<T> {
    if (!this.alive) throw new Error("会话已结束。");
    if (!route.startsWith("/") || route.startsWith("//")) throw new Error("请求路径无效。");
    const timeout = new AbortController();
    const abort = () => timeout.abort(); this.controller.signal.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(abort, API_TIMEOUT_MS);
    try {
      const response = await fetch(this.origin + API_PREFIX + route, { method, cache: "no-store", redirect: "error",
        credentials: "omit", signal: timeout.signal,
        headers: { Authorization: "Bearer " + this.token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (!this.alive) throw new Error("会话已结束。");
      if (!response.ok) {
        if (response.status === 401) this.unauthorized();
        throw new ApiError(response.status, errors[response.status] ?? "服务请求失败，请重试。");
      }
      const value = await boundedJson(response);
      if (!this.alive) throw new Error("会话已结束。");
      return value as T;
    } catch (error) {
      if (error instanceof ApiError || error instanceof Error && !["TypeError", "AbortError"].includes(error.name)) throw error;
      throw new Error(this.alive ? "请求失败或超时，请检查网络后重试。" : "会话已结束。");
    } finally { clearTimeout(timer); this.controller.signal.removeEventListener("abort", abort); }
  }

  /** 每个分片都固定发布版本；任何越界引用都在设置Bearer前拒绝。 */
  mediaRequest(xhr: XMLHttpRequest, address: string, team: string, recording: string, version: string) {
    if (!this.alive) throw new Error("会话已结束。");
    const url = new URL(address);
    const prefix = API_PREFIX + "/teams/" + team + "/recordings/" + recording + "/media/";
    if (url.origin !== this.origin || !url.pathname.startsWith(prefix)
      || !/^(index\.m3u8|init\.mp4|segment-\d{5}\.m4s)$/.test(url.pathname.slice(prefix.length))
      || url.username || url.password || url.hash) throw new Error("媒体引用超出当前录像。");
    url.search = ""; url.searchParams.set("version", version);
    xhr.open("GET", url.href, true); xhr.withCredentials = false;
    xhr.setRequestHeader("Authorization", "Bearer " + this.token);
  }

  mediaUrl(team: string, recording: string, version: string) {
    const url = new URL(API_PREFIX + "/teams/" + team + "/recordings/" + recording + "/media/index.m3u8", this.origin);
    url.searchParams.set("version", version); return url.href;
  }
}
