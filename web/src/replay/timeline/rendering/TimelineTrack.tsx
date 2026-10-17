import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "antd";
import { CloseCircleOutlined, QuestionCircleOutlined } from "@ant-design/icons";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import { eventLabels } from "@/shared/replay/events";
import { trackOverrideKey } from "@/shared/replay/tracks";
import { formatTime, groupMarkers, position } from "@/shared/replay/markers";
import { REPLAY_TRACK_DRAG_TYPE } from "@/shared/replay/config";
import { TIMELINE_KEY_STEP_SECONDS } from "@/config";
import { spellIcon } from "@/replay/timeline/rendering/spells";
import { useTimelineLayout } from "@/replay/timeline/layout/TimelineProvider";
import { EventDetails } from "@/replay/timeline/rendering/EventDetails";

interface Props {
  team: string; trackId: string; label: string; events: LocalTimelineEvent[]; current: number; duration: number; disabled: boolean;
  onTime: (seconds: number) => void; onEvent: (seconds: number, kind: string) => void;
  draggingKey: string | null; onDraggingChange: (key: string | null) => void; onAssign: (key: string, target: string) => void;
}

function SkillIcon({ event }: { event: LocalTimelineEvent }) {
  const icon = spellIcon(event.spellId), [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [icon]);
  return event.kind === "death" ? <CloseCircleOutlined /> : icon && !failed ? <img src={icon} alt={event.spellName} onError={() => setFailed(true)} />
    : <QuestionCircleOutlined aria-label="暂无技能图标" />;
}

/** 轨道位置是纯展示；鼠标拖动与详情选择仅提交同一显示规则键。 */
export function TimelineTrack({ team, events, current, duration, disabled, onTime, onEvent, label, trackId, draggingKey, onDraggingChange, onAssign }: Props) {
  const { layout } = useTimelineLayout(team);
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1), [preview, setPreview] = useState<number | null>(null), [dragOver, setDragOver] = useState(false);
  const size = layout.timelineTrackHeight * layout.timelineIconPercent / 100;
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width)); observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const markers = useMemo(() => groupMarkers(events, duration, width, size).map((marker) => ({ ...marker, rule: trackOverrideKey(marker.events[0]),
    homogeneous: marker.events.every((event) => trackOverrideKey(event) === trackOverrideKey(marker.events[0])) })), [events, duration, width, size]);
  const pointer = (element: HTMLElement, x: number) => { const box = element.getBoundingClientRect(); return box.width > 0 ? Math.min(1, Math.max(0, (x - box.left) / box.width)) * duration : 0; };
  return <div className="track-row" style={{ height: layout.timelineTrackHeight + 4 }} data-replay-track={trackId}>
    <span title={label}>{label}</span><div className={"track-canvas" + (draggingKey ? dragOver ? " track-drop-active" : " track-drop-ready" : "")} style={{ height: layout.timelineTrackHeight }} ref={root}
      onDragOver={(event) => { if (disabled || !draggingKey) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
      onDrop={(event) => {
        event.preventDefault(); setDragOver(false);
        if (!disabled && draggingKey && event.dataTransfer.getData(REPLAY_TRACK_DRAG_TYPE) === draggingKey) onAssign(draggingKey, trackId);
        onDraggingChange(null);
      }}>
      <button className="track-slider" role="slider" aria-label={"跳转到" + label + "时间"} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={preview ?? current} disabled={disabled}
        onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setPreview(pointer(event.currentTarget, event.clientX)); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPreview(pointer(event.currentTarget, event.clientX)); }}
        onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { event.currentTarget.releasePointerCapture(event.pointerId); onTime(pointer(event.currentTarget, event.clientX)); } setPreview(null); }}
        onPointerCancel={() => setPreview(null)} onLostPointerCapture={() => setPreview(null)}
        onKeyDown={(event) => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? duration : event.key === "ArrowLeft" ? current - TIMELINE_KEY_STEP_SECONDS : event.key === "ArrowRight" ? current + TIMELINE_KEY_STEP_SECONDS : null;
          if (next !== null) { event.preventDefault(); onTime(next); }
        }} />
      {markers.map((marker) => {
        const first = marker.events[0], rule = marker.rule;
        const draggable = !disabled && first.spellId > 0 && marker.homogeneous;
        return <Popover key={first.eventId} trigger={["hover", "click"]} content={<EventDetails events={marker.events} layout={layout} disabled={disabled} onEvent={onEvent} onAssign={onAssign} />}>
          <button className="event-marker" aria-label={(first.spellName || "死亡") + " " + eventLabels[first.kind] + " " + formatTime(first.pullTimeMs / 1000) + (marker.events.length > 1 ? " 等 " + marker.events.length + " 个事件" : "")}
            draggable={draggable} onDragStart={(event) => {
              if (!draggable) { event.preventDefault(); return; }
              event.dataTransfer.setData(REPLAY_TRACK_DRAG_TYPE, rule); event.dataTransfer.effectAllowed = "move"; onDraggingChange(rule);
            }} onDragEnd={() => { onDraggingChange(null); setDragOver(false); }} disabled={disabled}
            style={{ top: (layout.timelineTrackHeight - size) / 2, width: size, height: size, left: "clamp(" + size / 2 + "px, " + marker.percent + "%, calc(100% - " + size / 2 + "px))" }}
            onClick={() => { if (marker.events.length === 1) onEvent(first.pullTimeMs / 1000, first.kind); }}>
            <SkillIcon event={first} />{marker.events.length > 1 && <small>{marker.events.length}</small>}
          </button>
        </Popover>;
      })}
      <i className="track-cursor" style={{ left: position(preview ?? current, duration) + "%" }} />
    </div>
  </div>;
}
