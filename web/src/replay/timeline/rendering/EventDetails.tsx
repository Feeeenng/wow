import { useState } from "react";
import { Button, Select } from "antd";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import type { TimelineLayout } from "@/shared/replay/tracks";
import { allTimelineTracks, eventTrack, trackOverrideKey } from "@/shared/replay/tracks";
import { eventLabels } from "@/shared/replay/events";
import { formatTime } from "@/shared/replay/markers";
import { EVENT_DETAILS_PAGE_SIZE } from "@/config";

/** 大分组仅创建当前页控件，保留每个事件的身份、时间和独立移轨入口。 */
export function EventDetails({ events, layout, disabled, onEvent, onAssign }: {
  events: LocalTimelineEvent[]; layout: TimelineLayout; disabled: boolean;
  onEvent: (seconds: number, kind: string) => void; onAssign: (key: string, target: string) => void;
}) {
  const [requestedPage, setPage] = useState(0);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(events.length / EVENT_DETAILS_PAGE_SIZE) - 1));
  const start = page * EVENT_DETAILS_PAGE_SIZE, end = Math.min(events.length, start + EVENT_DETAILS_PAGE_SIZE);
  const definitions = allTimelineTracks(layout.customTimelineTracks);
  return <div className="event-popover">
    {events.length > EVENT_DETAILS_PAGE_SIZE && <div className="event-detail-pagination"><span>本组 {events.length} 个事件 · {start + 1}–{end}</span>
      <Button size="small" aria-label="上一页分组事件" disabled={!page} onClick={() => setPage(page - 1)}>上一页</Button>
      <Button size="small" aria-label="下一页分组事件" disabled={end === events.length} onClick={() => setPage(page + 1)}>下一页</Button></div>}
    {events.slice(start, end).map((event) => <div key={event.eventId} data-event-id={event.eventId} className="event-detail-row">
      <button disabled={disabled} onClick={() => onEvent(event.pullTimeMs / 1000, event.kind)}>
        <strong>{event.spellName || "死亡"} · {eventLabels[event.kind]} · {formatTime(event.pullTimeMs / 1000)}</strong>
        <span>{event.sourceName || "未知来源"} → {event.targetName || "未知目标"}</span>
        <span>{event.spellId > 0 ? "技能 " + event.spellId : "死亡事件"}{event.stackCount != null ? " · " + event.stackCount + " 层" : ""}{event.empowerLevel != null ? " · 蓄力等级 " + event.empowerLevel : ""} · 点击回看</span>
      </button>
      {event.spellId > 0 && <Select size="small" aria-label={"移动技能 " + event.eventId + " 到轨道"} value={eventTrack(event, layout.timelineTrackOverrides, layout.customTimelineTracks)} disabled={disabled}
        getPopupContainer={(trigger: HTMLElement) => trigger.closest<HTMLElement>(".ant-popover") ?? document.body}
        options={definitions.map((track) => ({ value: track.id, label: track.label }))} onChange={(target) => onAssign(trackOverrideKey(event), target)} />}
    </div>)}
  </div>;
}
