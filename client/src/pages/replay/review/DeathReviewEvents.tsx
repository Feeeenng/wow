import { memo, useMemo, useState } from "react";
import { Button, Input, Pagination, Select } from "antd";
import type { DeathReview, ReviewEvent } from "@/shared/review/model";
import { eventLabels } from "@/shared/replay/events";
import type { SpellMetadata } from "@/features/replay/metadata/service";
import { DEATH_REVIEW_DISPLAY_PAGE_SIZE } from "@/shared/review/config";

const labels = { ...eventLabels, damage: "受到伤害", heal: "获得治疗", absorb: "伤害吸收", healAbsorb: "治疗吸收" };
const amount = (value: number | null) => value === null ? "未提供" : value.toLocaleString("zh-CN");

function EventRow({ event, deathMs, metadata, canSeek, onTime }: {
  event: ReviewEvent; deathMs: number; metadata?: SpellMetadata; canSeek: (seconds: number) => boolean; onTime: (seconds: number) => void;
}) {
  const [failed, setFailed] = useState(false);
  const numeric = ["damage", "heal", "absorb", "healAbsorb"].includes(event.kind);
  return <div className="death-review-event" data-review-event={event.eventId}>
    <div><Button size="small" disabled={!canSeek(event.pullTimeMs / 1000)} aria-label={`定位明细 ${event.eventId}`} onClick={() => onTime(event.pullTimeMs / 1000)}>{event.pullTimeMs - deathMs} ms</Button>
      <small title={event.rawType}>{labels[event.kind]} · {event.rawType}</small></div>
    <div className="death-review-event-fact"><strong>{metadata?.iconUrl && !failed && <img src={metadata.iconUrl} alt="" onError={() => setFailed(true)} />}{event.spellName || (event.kind === "death" ? "死亡" : "未知技能")}{event.spellId > 0 ? ` · #${event.spellId}` : ""}</strong>
      <span>{event.sourceName || "未知来源"} → {event.targetName || "未知目标"}</span>
      {event.relatedSourceName && <span>关联来源：{event.relatedSourceName}</span>}
      {numeric && <span>记录值 {amount(event.amount)} · 吸收 {amount(event.absorbed)}{event.kind === "heal" ? ` · 过量治疗 ${amount(event.overheal)}` : event.kind === "damage" ? ` · 过量伤害 ${amount(event.overkill)}` : ""}</span>}
      {event.health !== null && <span>本人生命采样 {amount(event.health)} / {amount(event.maxHealth)}</span>}
      {event.stackCount !== null && <span>层数 {event.stackCount}</span>}
      {event.empowerLevel != null && <span>蓄力等级 {event.empowerLevel}</span>}
    </div>
  </div>;
}

/** 分页只控制展示，筛选覆盖当前已读取窗口；定位始终使用原事件时间。 */
export const DeathReviewEvents = memo(function DeathReviewEvents({ review, metadata, canSeek, onTime }: {
  review: DeathReview; metadata: Map<number, SpellMetadata>; canSeek: (seconds: number) => boolean; onTime: (seconds: number) => void;
}) {
  const [kind, setKind] = useState<string>(), [search, setSearch] = useState(""), [requestedPage, setPage] = useState(1);
  const events = useMemo(() => review.events.filter((event) => (!kind || event.kind === kind)
    && (!search.trim() || [event.spellName, event.sourceName, event.targetName, event.relatedSourceName ?? "", String(event.spellId), event.rawType ?? ""].join(" ").toLowerCase().includes(search.trim().toLowerCase()))), [review.events, kind, search]);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(events.length / DEATH_REVIEW_DISPLAY_PAGE_SIZE)));
  return <section className="death-review-events" aria-label="死亡窗口事件明细">
    <div className="death-review-filters"><Select allowClear aria-label="筛选死亡明细类型" placeholder="全部事件类型" value={kind} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} onChange={(value) => { setKind(value); setPage(1); }} />
      <Input aria-label="搜索死亡明细" value={search} placeholder="技能、人物或原始类型" onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
    <p>筛选结果 {events.length} 条 · 时间相对于死亡点，0 ms 为死亡记录</p>
    {events.slice((page - 1) * DEATH_REVIEW_DISPLAY_PAGE_SIZE, page * DEATH_REVIEW_DISPLAY_PAGE_SIZE).map((event) => <EventRow key={event.eventId} event={event} deathMs={review.death.pullTimeMs} metadata={metadata.get(event.spellId)} canSeek={canSeek} onTime={onTime} />)}
    {!events.length && <p>已读取记录中没有符合筛选的事件。</p>}
    <Pagination simple current={page} total={events.length} pageSize={DEATH_REVIEW_DISPLAY_PAGE_SIZE} showSizeChanger={false} onChange={setPage} />
  </section>;
});
