import { Alert, Tag } from "antd";
import { memo } from "react";
import type { DeathReview } from "@/shared/review/model";
import { observedAuras, reviewAmounts } from "@/shared/review/model";
import { eventActorKey } from "@/shared/replay/identity";

/** 统计沿用日志记录口径，光环仅表述已观测状态，不推断致死者或责任。 */
export const DeathReviewSummary = memo(function DeathReviewSummary({ review, complete }: { review: DeathReview; complete: boolean }) {
  const totals = reviewAmounts(review.events), auras = observedAuras(review.priorAuras, review.events, review.death);
  const lastDamage = review.events.filter((event) => event.kind === "damage").at(-1);
  return <div className="death-review-summary">
    <p>来源：{review.sourceKind === "wcl" ? "WCL公开报告快照" : "本地高级战斗日志"} · 窗口 {(review.windowEndMs - review.windowStartMs) / 1000} 秒 · 已读取 {review.events.length}/{review.total} 条</p>
    <div className="death-review-totals">
      <span>{complete ? "伤害记录值" : "已载入伤害记录值"}<strong>{totals.damage.amount?.toLocaleString("zh-CN") ?? "未提供"}</strong><small>{totals.damage.knownCount}/{totals.damage.count} 条提供数值</small></span>
      <span>{complete ? "治疗记录值" : "已载入治疗记录值"}<strong>{totals.healing.amount?.toLocaleString("zh-CN") ?? "未提供"}</strong><small>{totals.healing.knownCount}/{totals.healing.count} 条提供数值</small></span>
    </div>
    <p className="text-xs text-[var(--app-text-secondary)]">以上是已读取的来源记录值，不是有效伤害／治疗。{review.sourceKind === "combatLog" ? "近战仅移除完全匹配的双份记录。" : "WCL与本地日志口径可能不同，不能跨来源直接相加。"}吸收、过量和生命采样分列，不能据此推断责任。</p>
    <p>致死关联：当前来源未提供已核对的直接致死技能关联。</p>
    {lastDamage && <p>末次已载入伤害：{lastDamage.spellName || "未知技能"} · {lastDamage.sourceName || "未知来源"} · 死前 {review.death.pullTimeMs - lastDamage.pullTimeMs} ms（不等同明确致死关联）</p>}
    {(review.truncated || review.priorAurasTruncated || review.parseErrors > 0 || totals.damage.overflow || totals.healing.overflow) && <Alert type="warning" showIcon message="当前记录可能不完整"
      description={[review.truncated && `明细仅保留最近 ${review.total} 条`, review.priorAurasTruncated && "窗口前光环记录达到保留上限", review.parseErrors > 0 && `${review.parseErrors} 行读取解析失败`, (totals.damage.overflow || totals.healing.overflow) && "合计超出安全数值范围"].filter(Boolean).join("；")} />}
    <p>已观测光环{!complete ? "（读取未完成）" : ""}：不保证包含开战前状态，不能直接解释为完整减伤覆盖。</p>
    <div>{auras.events.map((event) => <Tag key={event.kind + ":" + event.spellId + ":" + eventActorKey(event, "source")}>{event.kind.startsWith("debuff") ? "减益" : "增益"} · {event.spellName || event.spellId}{event.stackCount != null ? ` ×${event.stackCount}` : ""} · {event.sourceName || "未知来源"}</Tag>)}
      {!auras.events.length && <span className="text-xs text-[var(--app-text-secondary)]">当前已读取记录中没有可确认的残留光环。</span>}</div>
    {auras.ambiguousRemoval && <p>存在未提供来源身份的光环移除，状态可能不完整。</p>}
  </div>;
});
