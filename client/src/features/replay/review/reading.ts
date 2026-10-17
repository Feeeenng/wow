import type { DeathReview, DeathReviewPage } from "@/shared/review/model";
import { DEATH_REVIEW_MAX_ROWS, DEATH_REVIEW_PAGE_SIZE } from "@/shared/review/config";

/** 分页固定同一死亡与日志快照，读取未完成时不能冒充完整窗口。 */
export async function readDeathReview(eventId: string, request: (cursor: string | null) => Promise<DeathReviewPage>,
  active: () => boolean, progress: (review: DeathReview) => void, sourceKind: DeathReview["sourceKind"] = "combatLog"): Promise<DeathReview | null> {
  let cursor: string | null = null, first: DeathReviewPage | null = null;
  const cursors = new Set<string>(), ids = new Set<string>();
  const events: DeathReview["events"] = [];
  while (active()) {
    const page = await request(cursor);
    if (!active()) return null;
    if (page.death.eventId !== eventId || page.sourceKind !== sourceKind) throw new Error("死亡明细来源与所选记录不一致，请重新读取。");
    if (page.availability !== "ready") {
      if (first) throw new Error("死亡明细读取期间来源已变化，请重新读取。");
      return page;
    }
    if (!page.revision || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > DEATH_REVIEW_MAX_ROWS
      || page.events.length > DEATH_REVIEW_PAGE_SIZE) throw new Error("死亡明细数量超出允许范围。");
    if (first && (page.revision !== first.revision || page.total !== first.total || page.windowStartMs !== first.windowStartMs || page.windowEndMs !== first.windowEndMs)) {
      throw new Error("死亡明细版本已变化，请重新读取。");
    }
    first ??= page;
    for (const event of page.events) {
      if (ids.has(event.eventId) || !Number.isFinite(event.pullTimeMs) || event.pullTimeMs < first.windowStartMs || event.pullTimeMs > first.windowEndMs
        || events.length && event.pullTimeMs < events[events.length - 1].pullTimeMs) throw new Error("死亡明细分页包含重复、乱序或越界记录。");
      ids.add(event.eventId); events.push(event);
    }
    if (events.length > first.total || page.hasMore && !page.events.length || !page.hasMore && events.length !== first.total) throw new Error("死亡明细分页不完整，请重新读取。");
    const review = { ...first, events: [...events] };
    progress(review);
    if (!page.hasMore) return review;
    if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error("死亡明细分页没有推进，请重新读取。");
    cursors.add(page.nextCursor); cursor = page.nextCursor;
  }
  return null;
}
