import { memo, useMemo, useState } from "react";
import { Button, Pagination, Tag } from "antd";
import type { DeathReview } from "@/shared/review/model";
import { reviewMechanics } from "@/shared/review/mechanics/classification";
import { mechanicCatalogBuild } from "@/shared/review/mechanics/catalog";
import { DEATH_REVIEW_DISPLAY_PAGE_SIZE } from "@/shared/review/config";

const kinds = { reduction: "承伤降低", absorb: "吸收", immunity: "免疫", transfer: "伤害分摊", consumable: "治疗耗材" };
const scopes = { personal: "个人", external: "外部", group: "团队范围资料", unknown: "来源身份未确认" };

/** 使用统一主题展示资料分类与原始证据，定位仍按实际日志时间。 */
export const DeathReviewMechanics = memo(function DeathReviewMechanics({ review, complete, canSeek, onTime }: {
  review: DeathReview; complete: boolean; canSeek: (seconds: number) => boolean; onTime: (seconds: number) => void;
}) {
  const records = useMemo(() => reviewMechanics(review), [review]);
  const [requestedPage, setPage] = useState(1);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(records.length / DEATH_REVIEW_DISPLAY_PAGE_SIZE)));
  return <section aria-label="减伤与治疗耗材记录" className="death-review-events">
    <strong>减伤与治疗耗材{!complete ? "（读取未完成）" : ""}</strong>
    <p className="text-xs text-[var(--app-text-secondary)]">参考资料 {mechanicCatalogBuild}，不保证与日志热修一致。仅收录已核对的技能；分类不代表实际减伤量、完整覆盖或冷却可用。施法与治疗是独立记录，不相加为使用次数。</p>
    {records.slice((page - 1) * DEATH_REVIEW_DISPLAY_PAGE_SIZE, page * DEATH_REVIEW_DISPLAY_PAGE_SIZE).map(({ event, kinds: categories, scope, itemIds }) => <div className="death-review-event" key={event.eventId} data-review-mechanic={event.eventId}>
      <Button size="small" disabled={!canSeek(event.pullTimeMs / 1000)} aria-label={`定位分类记录 ${event.eventId}`} onClick={() => onTime(event.pullTimeMs / 1000)}>{event.pullTimeMs - review.death.pullTimeMs} ms</Button>
      <div className="death-review-event-fact"><strong>{event.spellName || `技能 ${event.spellId}`}</strong>
        <span>{scopes[scope]} · {event.kind === "castSuccess" ? "成功施法" : event.kind === "heal" ? "治疗记录" : "增益记录"} · {event.sourceName && event.sourceName !== "nil" ? event.sourceName : "未知来源"}</span>
        <div>{categories.map((kind) => <Tag key={kind}>{kinds[kind]}</Tag>)}</div>
        {!!itemIds.length && <small>资料关联物品：{itemIds.join("、")}</small>}
      </div>
    </div>)}
    {!records.length && <p>当前已读取窗口没有命中已核对分类的记录，不能据此判断没有使用减伤或耗材。</p>}
    {!!records.length && <Pagination simple current={page} total={records.length} pageSize={DEATH_REVIEW_DISPLAY_PAGE_SIZE} showSizeChanger={false} onChange={setPage} />}
  </section>;
});
