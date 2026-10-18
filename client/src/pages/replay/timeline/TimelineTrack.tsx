import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "antd";
import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";
import type { SpellMetadata } from "@/features/replay/metadata/service";
import { REPLAY_BOSS_LABEL_MAX_WIDTH, REPLAY_KEY_STEP_SECONDS, REPLAY_MARKER_EDGE_MARGIN, REPLAY_TIMELINE_ICON_SIZE, REPLAY_TIMELINE_LANE_HEIGHT } from "@/features/replay/config";
import { formatTime, position } from "@/shared/replay/markers";
import { SkillTooltip } from "@/pages/replay/timeline/SkillTooltip";
import { layoutSkillMarkers } from "@/pages/replay/timeline/viewport/markers";
import { formatTimelineTime } from "@/pages/replay/timeline/viewport/model";

interface Props {
  label: string;
  events: LocalTimelineEvent[];
  currentTime: number;
  duration: number;
  startTime?: number;
  endTime?: number;
  disabled: boolean;
  color: string;
  metadata: Map<number, SpellMetadata>;
  onTimeChange: (seconds: number) => void;
  onEventTimeChange: (seconds: number, kind: LocalTimelineEventKind) => void;
  trackId: string;
}

/** 缺图时显示真实技能ID，不用问号或相似图片冒充技能。 */
function SkillIcon({ event, metadata }: { event: LocalTimelineEvent; metadata?: SpellMetadata }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [metadata?.iconUrl]);
  return metadata?.iconUrl && !failed ? <img className="h-full w-full object-cover" src={metadata.iconUrl} alt={metadata.name || event.spellName} onError={() => setFailed(true)} />
    : <span className="break-all text-center text-[8px] leading-none" aria-label={`技能ID ${event.spellId}`}>{event.spellId}</span>;
}

/** 同一轨道的拖动、键盘和事件定位共用业务时间入口。 */
export function TimelineTrack({ label, events, currentTime, duration, startTime = 0, endTime = duration, disabled, color, metadata, onTimeChange, onEventTimeChange, trackId }: Props) {
  const iconSize = REPLAY_TIMELINE_ICON_SIZE;
  const [preview, setPreview] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(1);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // 分组规则随事件及布局变化计算，播放游标更新时不重复扫描整场来源身份。
  const span = Math.max(0, endTime - startTime);
  const markers = useMemo(() => layoutSkillMarkers(events, startTime, endTime, width, iconSize), [events, width, iconSize, startTime, endTime]);
  const rowHeight = markers.reduce((lanes, marker) => Math.max(lanes, marker.lane + 1), 1) * REPLAY_TIMELINE_LANE_HEIGHT;
  const pointerTime = (button: HTMLButtonElement, x: number) => {
    const bounds = button.getBoundingClientRect();
    return bounds.width > 0 ? startTime + Math.min(1, Math.max(0, (x - bounds.left) / bounds.width)) * span : startTime;
  };
  return (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
      <span className="truncate text-xs text-[var(--app-text-secondary)]" title={label}>{label}</span>
      <div ref={root} data-replay-track={trackId} className="replay-timeline-track relative min-w-0" style={{ height: rowHeight }}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHover(startTime + Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)) * span);
        }} onPointerLeave={() => setHover(null)}>
        <button type="button" role="slider" aria-label={`跳转到${label}时间`} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={preview ?? currentTime}
          className="absolute inset-0 w-full border-y disabled:cursor-not-allowed"
          style={{ touchAction: "none" }} disabled={disabled}
          onPointerDown={(event) => {
            if (duration <= 0 || event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            setPreview(pointerTime(event.currentTarget, event.clientX));
          }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setPreview(pointerTime(event.currentTarget, event.clientX)); }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            onTimeChange(pointerTime(event.currentTarget, event.clientX)); setPreview(null);
          }}
          onPointerCancel={() => setPreview(null)} onLostPointerCapture={() => setPreview(null)}
          onKeyDown={(event) => {
            const next = event.key === "Home" ? 0 : event.key === "End" ? duration
              : event.key === "ArrowRight" ? currentTime + REPLAY_KEY_STEP_SECONDS
              : event.key === "ArrowLeft" ? currentTime - REPLAY_KEY_STEP_SECONDS : null;
            if (next !== null) { event.preventDefault(); onTimeChange(next); }
          }}
        />
        {markers.map((marker, index) => {
          const first = marker.events[0];
          const name = metadata.get(first.spellId)?.name || first.spellName || `技能 ${first.spellId}`;
          const next = markers.slice(index + 1).find((item) => item.lane === marker.lane);
          const labelWidth = Math.max(iconSize, Math.min(REPLAY_BOSS_LABEL_MAX_WIDTH, next ? next.x - marker.x - REPLAY_MARKER_EDGE_MARGIN : width - marker.x));
          const inset = iconSize / 2 + REPLAY_MARKER_EDGE_MARGIN;
          const center = Math.min(width - inset, Math.max(inset, marker.x));
          const labelLeft = Math.max(0, Math.min(width - labelWidth, center - labelWidth / 2)) - (center - iconSize / 2);
          return <Popover key={first.eventId || `${first.pullTimeMs}-${index}`} trigger="hover" destroyOnHidden content={<SkillTooltip event={first} metadata={metadata.get(first.spellId)} />}>
            <button type="button" disabled={disabled} aria-label={`${name} 技能ID ${first.spellId} ${formatTime(first.pullTimeMs / 1_000)}${marker.events.length > 1 ? ` 等 ${marker.events.length} 个事件` : ""}`}
              className="absolute z-10 flex -translate-x-1/2 items-center justify-center overflow-visible rounded-[3px] border bg-[var(--app-surface)] shadow-sm disabled:cursor-not-allowed"
              style={{ left: center, top: marker.lane * REPLAY_TIMELINE_LANE_HEIGHT + 4, width: iconSize, height: iconSize, borderColor: color }}
              onClick={() => { onEventTimeChange(first.pullTimeMs / 1_000, first.kind); }}>
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[2px]"><SkillIcon event={first} metadata={metadata.get(first.spellId)} /></span>
              {marker.events.length > 1 && <span className="absolute -right-1 -top-1 rounded bg-[var(--app-surface)] px-0.5 text-[10px]">{marker.events.length}</span>}
              {trackId === "boss" && <span data-boss-skill-name className="pointer-events-none absolute truncate text-[10px] leading-3 text-[var(--app-text-secondary)]"
                style={{ top: iconSize + 2, left: labelLeft, width: labelWidth }}>{name}</span>}
            </button>
          </Popover>;
        })}
        {(preview !== null || currentTime >= startTime && currentTime <= endTime) && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-[var(--app-primary)]" style={{ left: `${position((preview ?? currentTime) - startTime, span)}%` }} />}
        {(preview ?? hover) !== null && <>
          <span className="replay-timeline-hover-line" style={{ left: `${position((preview ?? hover)! - startTime, span)}%` }} />
          <span className="replay-timeline-hover-time" data-hover-seconds={(preview ?? hover)!.toFixed(3)} style={{ left: `clamp(36px, ${position((preview ?? hover)! - startTime, span)}%, calc(100% - 36px))` }}>{formatTimelineTime((preview ?? hover)!, true)}</span>
        </>}

      </div>
    </div>
  );
}
