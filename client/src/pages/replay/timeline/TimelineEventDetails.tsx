import { useState } from "react";
import { Button, Select } from "antd";
import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";
import type { TimelineLayout } from "@/shared/replay/tracks";
import { allTimelineTracks, canAssignTimelineTrack, eventTrack, trackOverrideKey } from "@/shared/replay/tracks";
import type { SpellMetadata } from "@/features/replay/metadata/service";
import { formatTime } from "@/shared/replay/markers";
import { REPLAY_EVENT_DETAILS_PAGE_SIZE } from "@/shared/replay/config";

/** 大分组按页展示，逐事件选择目标轨道供键盘／触屏使用，不改时间或来源身份。 */
export function TimelineEventDetails({ events, metadata, layout, disabled, onEvent, onAssign, onDeathReview }: {
  events: LocalTimelineEvent[]; layout: TimelineLayout; disabled: boolean;
  metadata: Map<number, SpellMetadata>;
  onEvent: (seconds: number, kind: LocalTimelineEventKind) => void; onAssign?: (key: string, target: string) => void;
  onDeathReview?: (event: LocalTimelineEvent) => void;
}) {
  const [requestedPage, setPage] = useState(0);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(events.length / REPLAY_EVENT_DETAILS_PAGE_SIZE) - 1));
  const start = page * REPLAY_EVENT_DETAILS_PAGE_SIZE, end = Math.min(events.length, start + REPLAY_EVENT_DETAILS_PAGE_SIZE);
  const tracks = allTimelineTracks(layout.customTimelineTracks);
  return <div role="group" className="max-h-80 w-[360px] max-w-[80vw] space-y-2 overflow-auto" aria-label="时间轴分组事件详情">
    {onAssign && <p className="text-xs text-[var(--app-text-secondary)]">同一归属、来源、技能和类型的事件会一起移轨，日志与回看时间保持原样。</p>}
    {events.length > REPLAY_EVENT_DETAILS_PAGE_SIZE && <div className="flex flex-wrap items-center gap-2 text-xs">
      <span>本组 {events.length} 个事件 · {start + 1}–{end}</span>
      <Button size="small" aria-label="上一页分组事件" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
      <Button size="small" aria-label="下一页分组事件" disabled={end === events.length} onClick={() => setPage(page + 1)}>下一页</Button>
    </div>}
    {events.slice(start, end).map((event) => <div key={event.eventId} data-event-id={event.eventId} className="space-y-1 border-b border-[var(--app-border)] pb-2">
      <button type="button" disabled={disabled} className="block w-full rounded-[4px] p-1 text-left hover:bg-[var(--app-border)] disabled:cursor-not-allowed" onClick={() => onEvent(event.pullTimeMs / 1000, event.kind)}>
        <strong className="block text-xs">{metadata.get(event.spellId)?.name || event.spellName || "未知技能"}</strong>
        <code className="block text-xs font-medium">技能 ID：{event.spellId}</code>
        <span className="block text-xs text-[var(--app-text-secondary)]">{event.sourceName && event.sourceName !== "nil" ? event.sourceName : "未知来源"} → {event.targetName || "未知目标"}</span>
        <span className="block text-xs text-[var(--app-text-secondary)]">{formatTime(event.pullTimeMs / 1000)}{event.stackCount != null ? ` · ${event.stackCount} 层` : ""}{event.empowerLevel != null ? ` · 蓄力等级 ${event.empowerLevel}` : ""}{event.extraSpellId != null ? ` · 关联技能 ${event.extraSpellId}` : ""} · 点击回看</span>
      </button>
      {onAssign && event.spellId > 0 && <Select size="small" className="w-full" aria-label={`移动${event.spellName || "技能"} · ${event.sourceName && event.sourceName !== "nil" ? event.sourceName : "未知来源"} · ${event.pullTimeMs}毫秒到轨道`} value={eventTrack(event, layout.timelineTrackOverrides, layout.customTimelineTracks)} disabled={disabled || !canAssignTimelineTrack(event)}
        title={!canAssignTimelineTrack(event) ? "缺少明确来源身份，暂不能移轨" : undefined}
        getPopupContainer={(trigger: HTMLElement) => trigger.closest<HTMLElement>(".ant-popover") ?? document.body}
        options={tracks.map((track) => ({ value: track.id, label: track.label }))} onChange={(target) => onAssign(trackOverrideKey(event), target)} />}
      {event.kind === "death" && onDeathReview && <Button size="small" aria-label={`查看死亡明细 ${event.eventId}`} onClick={() => onDeathReview(event)}>查看死亡明细</Button>}
    </div>)}
  </div>;
}
