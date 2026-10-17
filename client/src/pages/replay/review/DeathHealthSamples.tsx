import type { DeathReview } from "@/shared/review/model";
import { memo } from "react";

/** 只绘制明确属于死者的离散生命采样，不补零、不连线推测中间变化。 */
export const DeathHealthSamples = memo(function DeathHealthSamples({ review }: { review: DeathReview }) {
  const samples = review.events.filter((event) => event.health !== null && event.maxHealth !== null && event.maxHealth > 0);
  const span = Math.max(1, review.windowEndMs - review.windowStartMs);
  return <section aria-label="死者生命值采样" className="death-health-samples">
    <strong>生命值采样</strong>
    {!samples.length ? <p>日志没有提供明确属于死者的生命采样，不推算生命曲线。</p> : <>
      <svg viewBox="0 0 640 130" role="img" aria-label={`已读取${samples.length}个死者生命采样，点之间不推断连续变化`}>
        <path d="M35 10V110H625" fill="none" stroke="var(--app-border)" />
        <text x="0" y="18">100%</text><text x="10" y="110">0%</text>
        {samples.map((event) => <circle key={event.eventId} cx={35 + (event.pullTimeMs - review.windowStartMs) / span * 590} cy={110 - event.health! / event.maxHealth! * 100} r="3" fill="var(--app-primary)">
          <title>{event.pullTimeMs - review.death.pullTimeMs} ms · {event.health}/{event.maxHealth}</title>
        </circle>)}
        <text x="35" y="128">窗口开始</text><text x="595" y="128">死亡</text>
      </svg>
      <p>仅显示日志采样点，数值见对应事件；未采样的区间保持未知。</p>
    </>}
  </section>;
});
