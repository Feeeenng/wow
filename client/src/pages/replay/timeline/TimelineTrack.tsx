import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "antd";
import { CloseCircleOutlined } from "@ant-design/icons";
import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";
import type { SpellMetadata } from "@/features/replay/metadata/service";
import { REPLAY_BOSS_LABEL_MAX_WIDTH, REPLAY_KEY_STEP_SECONDS, REPLAY_MARKER_EDGE_MARGIN } from "@/features/replay/config";
import { REPLAY_TRACK_DRAG_TYPE } from "@/shared/replay/config";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { canAssignTimelineTrack, trackOverrideKey } from "@/shared/replay/tracks";
import { formatTime, groupMarkers, position } from "@/shared/replay/markers";
import { TimelineEventDetails } from "@/pages/replay/timeline/TimelineEventDetails";

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
  draggingKey?: string | null;
  onDraggingChange?: (key: string | null) => void;
  onAssign?: (key: string, trackId: string) => void;
  onDeathReview?: (event: LocalTimelineEvent) => void;
}

/** 缺图时显示真实技能ID，不用问号或相似图片冒充技能。 */
function SkillIcon({ event, metadata }: { event: LocalTimelineEvent; metadata?: SpellMetadata }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [metadata?.iconUrl]);
  if (event.kind === "death") return <CloseCircleOutlined />;
  return metadata?.iconUrl && !failed ? <img className="h-full w-full object-cover" src={metadata.iconUrl} alt={metadata.name || event.spellName} onError={() => setFailed(true)} />
    : <span className="break-all text-center text-[8px] leading-none" aria-label={`技能ID ${event.spellId}`}>{event.spellId}</span>;
}

/** 同一轨道的拖动、键盘和事件定位共用业务时间入口。 */
export function TimelineTrack({ label, events, currentTime, duration, startTime = 0, endTime = duration, disabled, color, metadata, onTimeChange, onEventTimeChange, trackId, draggingKey, onDraggingChange, onAssign, onDeathReview }: Props) {
  const { preferences } = useReplayState();
  const iconSize = preferences.timelineTrackHeight * preferences.timelineIconPercent / 100;
  const [preview, setPreview] = useState<number | null>(null);
  const [width, setWidth] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  useEffect(() => { if (!draggingKey) setDragOver(false); }, [draggingKey]);
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
  const markers = useMemo(() => groupMarkers(events.filter((event) => event.pullTimeMs >= startTime * 1000 && event.pullTimeMs <= endTime * 1000), duration, span > 0 ? width * duration / span : width, iconSize).map((marker) => {
    const key = trackOverrideKey(marker.events[0]);
    return { ...marker, percent: position(marker.events[0].pullTimeMs / 1000 - startTime, span), rule: key, homogeneous: marker.events.every((event) => trackOverrideKey(event) === key) };
  }), [events, duration, width, iconSize, startTime, endTime, span]);
  const pointerTime = (button: HTMLButtonElement, x: number) => {
    const bounds = button.getBoundingClientRect();
    return bounds.width > 0 ? startTime + Math.min(1, Math.max(0, (x - bounds.left) / bounds.width)) * span : startTime;
  };
  return (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
      <span className="truncate text-xs text-[var(--app-text-secondary)]" title={label}>{label}</span>
      <div ref={root} data-replay-track={trackId} className={`replay-timeline-track relative min-w-0 ${draggingKey ? dragOver ? "outline outline-1 outline-dashed outline-[var(--app-primary)] bg-[var(--app-primary)]/15" : "outline outline-1 outline-dashed outline-[var(--app-border)]" : ""}`} style={{ height: preferences.timelineTrackHeight }}
        onDragOver={(event) => { if (disabled || !draggingKey) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
        onDrop={(event) => {
          event.preventDefault(); setDragOver(false);
          if (disabled || !draggingKey) return;
          const key = event.dataTransfer.getData(REPLAY_TRACK_DRAG_TYPE);
          if (key === draggingKey) onAssign?.(key, trackId);
          onDraggingChange?.(null);
        }}>
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
          const first = marker.events[0], key = marker.rule;
          const name = metadata.get(first.spellId)?.name || first.spellName || `技能 ${first.spellId}`;
          const previousSpace = index > 0 ? (marker.percent - markers[index - 1].percent) / 100 * width : REPLAY_BOSS_LABEL_MAX_WIDTH;
          const nextSpace = index + 1 < markers.length ? (markers[index + 1].percent - marker.percent) / 100 * width : REPLAY_BOSS_LABEL_MAX_WIDTH;
          const labelWidth = Math.max(iconSize, Math.min(REPLAY_BOSS_LABEL_MAX_WIDTH, previousSpace, nextSpace) - REPLAY_MARKER_EDGE_MARGIN);
          const inset = iconSize / 2 + REPLAY_MARKER_EDGE_MARGIN;
          const center = Math.min(width - inset, Math.max(inset, marker.percent / 100 * width));
          const labelLeft = Math.max(0, Math.min(width - labelWidth, center - labelWidth / 2)) - (center - iconSize / 2);
          const draggable = !!onAssign && !disabled && canAssignTimelineTrack(first) && marker.homogeneous;
          return <Popover key={first.eventId || `${first.pullTimeMs}-${index}`} trigger={["hover", "click"]} content={(
            <TimelineEventDetails events={marker.events} metadata={metadata} layout={preferences} disabled={disabled} onEvent={onEventTimeChange} onAssign={onAssign} onDeathReview={onDeathReview} />
          )}>
            <button type="button" disabled={disabled} aria-label={`${name} 技能ID ${first.spellId} ${formatTime(first.pullTimeMs / 1_000)}${marker.events.length > 1 ? ` 等 ${marker.events.length} 个事件` : ""}`}
              draggable={draggable}
              onDragStart={(event) => {
                if (!draggable) { event.preventDefault(); return; }
                event.dataTransfer.setData(REPLAY_TRACK_DRAG_TYPE, key);
                event.dataTransfer.effectAllowed = "move";
                onDraggingChange?.(key);
              }}
              onDragEnd={() => { onDraggingChange?.(null); setDragOver(false); }}
              className="absolute top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-visible rounded-[3px] border bg-[var(--app-surface)] shadow-sm disabled:cursor-not-allowed"
              style={{ left: `clamp(${inset}px, ${marker.percent}%, calc(100% - ${inset}px))`, width: iconSize, height: iconSize, borderColor: color }}
              onClick={() => { if (marker.events.length === 1) onEventTimeChange(first.pullTimeMs / 1_000, first.kind); }}>
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[2px]"><SkillIcon event={first} metadata={metadata.get(first.spellId)} /></span>
              {marker.events.length > 1 && <span className="absolute -right-1 -top-1 rounded bg-[var(--app-surface)] px-0.5 text-[10px]">{marker.events.length}</span>}
              {trackId === "boss" && <span data-boss-skill-name className="pointer-events-none absolute truncate text-[10px] leading-3 text-[var(--app-text-secondary)]"
                style={{ top: iconSize + 2, left: labelLeft, width: labelWidth }}>{name}</span>}
            </button>
          </Popover>;
        })}
        {(preview !== null || currentTime >= startTime && currentTime <= endTime) && <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-[var(--app-primary)]" style={{ left: `${position((preview ?? currentTime) - startTime, span)}%` }} />}
        {preview !== null && <span className="pointer-events-none absolute -top-3 text-xs tabular-nums text-[var(--app-primary)]" style={{ left: `clamp(0px, ${position(preview - startTime, span)}%, calc(100% - 40px))` }}>{formatTime(preview)}</span>}
      </div>
    </div>
  );
}
