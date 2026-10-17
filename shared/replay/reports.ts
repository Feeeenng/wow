export interface WclActorBinding {
  recordingId: string;
  actorId: number;
}

export interface WclImportRequest {
  reportCode: string;
  fightId: number;
  actorBindings: WclActorBinding[];
  refresh?: boolean;
}

export interface WclReportStatus {
  configured: boolean;
  canImport: boolean;
  status: "unbound" | "pending" | "importing" | "ready" | "failed";
  jobId?: string | null;
  reportCode?: string | null;
  fightId?: number | null;
  revision?: string | null;
  eventCount: number;
  actors: { actorId: number; name: string; type: string | null; subType?: string | null; gameId?: number | null }[];
  actorBindings: WclActorBinding[];
  error?: string | null;
  publishedReportCode?: string | null;
  publishedFightId?: number | null;
  publishedReportRevision?: number | null;
  rawEventCount?: number;
}

/** 只提取官方报告身份，不根据用户输入请求任意网站或接受私人授权参数。 */
export function parseWclReference(value: string): { reportCode: string; fightId: number | null } | null {
  const text = value.trim();
  if (/^[A-Za-z0-9]{16}$/.test(text)) return { reportCode: text, fightId: null };
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !(url.hostname === "warcraftlogs.com" || url.hostname.endsWith(".warcraftlogs.com"))) return null;
    const report = /^\/reports\/([A-Za-z0-9]{16})\/?$/.exec(url.pathname);
    if (!report) return null;
    const rawFight = new URLSearchParams(url.hash.slice(1)).get("fight") ?? url.searchParams.get("fight");
    const fight = rawFight && /^\d+$/.test(rawFight) ? Number(rawFight) : null;
    return { reportCode: report[1], fightId: Number.isSafeInteger(fight) && (fight ?? 0) > 0 ? fight : null };
  } catch { return null; }
}
