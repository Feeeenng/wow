import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";

export interface ReplayEventPage {
  revision: string;
  events: LocalTimelineEvent[];
  total: number;
  nextCursor: string;
  hasMore: boolean;
  reset: boolean;
}

export interface ReplayEventSnapshot {
  events: LocalTimelineEvent[];
  cursor: string | null;
  revision: string | null;
}

/** 只有当前快照读取到末页，才能把“没有匹配”解释为完整筛选结果。 */
export async function readEventSnapshot(
  initial: ReplayEventSnapshot,
  readPage: (cursor: string | null) => Promise<ReplayEventPage>,
  isActive: () => boolean,
  progress: (loaded: number, total: number) => void,
): Promise<ReplayEventSnapshot | null> {
  // 请求期间使用自己的数组，逐页追加不反复复制已读取的十万级事件。
  const snapshot = { ...initial, events: initial.events.slice() };
  while (isActive()) {
    const page = await readPage(snapshot.cursor);
    if (!isActive()) return null;
    if (page.hasMore && page.nextCursor === snapshot.cursor && !page.reset) {
      throw new Error("事件分页游标未推进，请重新加载");
    }
    if (page.reset) snapshot.events = [];
    snapshot.events.push(...page.events);
    snapshot.cursor = page.nextCursor;
    snapshot.revision = page.revision;
    progress(snapshot.events.length, page.total);
    if (!page.hasMore) return snapshot;
  }
  return null;
}

export const eventLabels: Record<LocalTimelineEventKind, string> = {
  castStart: "施法开始", castSuccess: "施法成功", death: "死亡",
  empowerStart: "蓄力开始", empowerEnd: "蓄力释放", empowerInterrupt: "蓄力中断", resurrect: "复活",
  buffApply: "增益获得", buffRemove: "增益移除", buffStack: "增益叠层",
  debuffApply: "减益获得", debuffRemove: "减益移除", debuffStack: "减益叠层",
  interrupt: "打断", dispel: "驱散",
  buffRefresh: "增益刷新", debuffRefresh: "减益刷新",
};
