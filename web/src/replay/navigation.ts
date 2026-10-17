import { uuid } from "@/replay/catalog/model";

export interface ReplayLink { team: string | null; pull: string | null; view: string | null; seconds: number; }

/** 链接只承载有权限成员可读的资源身份及时间，不接收令牌或API服务器。 */
export function readReplayLink(search: string): ReplayLink {
  const query = new URLSearchParams(search);
  const id = (key: string) => uuid(query.get(key)) ? query.get(key)!.toLowerCase() : null;
  const time = Number(query.get("t") ?? 0);
  return { team: id("team"), pull: id("pull"), view: id("view"), seconds: Number.isSafeInteger(Math.round(time * 1000)) && time >= 0 ? time : 0 };
}

export function replayLink(base: string, team: string, pull: string, view: string, seconds: number) {
  const url = new URL(base); url.search = ""; url.hash = ""; url.username = ""; url.password = "";
  url.searchParams.set("team", team); url.searchParams.set("pull", pull); url.searchParams.set("view", view);
  url.searchParams.set("t", Math.max(0, Math.round(seconds * 1000) / 1000).toString());
  return url.href;
}
