import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "antd";
import { QuestionCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";
import type { SpellMetadata } from "@/features/replay/metadata";
import { REPLAY_KEY_STEP_SECONDS } from "@/features/replay/config";
import { REPLAY_TRACK_DRAG_TYPE } from "@/shared/replay/config";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { trackOverrideKey } from "@/shared/replay/tracks";
import { eventLabels } from "@/shared/replay/events";
import { formatTime, groupMarkers, position } from "@/shared/replay/markers";

interface Props {
  label: string;
  events: LocalTimelineEvent[];
  currentTime: number;
  duration: number;
  disabled: boolean;
  color: string;
  metadata: Map<number, SpellMetadata>;
  onTimeChange: (seconds: number) => void;
  onEventTimeChange: (seconds: number, kind: LocalTimelineEventKind) => void;
  trackId: string;
  draggingKey: string | null;
  onDraggingChange: (key: string | null) => void;
  onAssign: (key: string, trackId: string) => void;
}

/** 小图加载失败时展示缺图提示，不将普通操作图标冒充魔兽技能图片。 */
function SkillIcon({ event, metadata }: { event: LocalTimelineEvent; metadata?: SpellMetadata }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [metadata?.iconUrl]);
  if (event.kind === "death") return <CloseCircleOutlined />;
  return metadata?.iconUrl && !failed ? <img className="h-full w-full object-cover" src={metadata.iconUrl} alt={event.spellName} onError={() => setFailed(true)} />
    : <QuestionCircleOutlined aria-label="暂无技能图标" />;
}

/** 同一轨道的拖动、键盘和事件定位共用业务时间入口。 */
export function TimelineTrack({ label, events, currentTime, duration, disabled, color, metadata, onTimeChange, onEventTimeChange, trackId, draggingKey, onDraggingChange, onAssign }: Props) {
  const { preferences } = useReplayState();
  const iconSize = preferences.timelineTrackHeight * preferences.timelineIconPercent / 100;
  const [preview, setPreview] = useState<number | null>(null);
  const [width, setWidth] = useState(1);
  const [dragOver, setDragOver] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const markers = useMemo(() => groupMarkers(events, duration, width, iconSize), [events, duration, width, iconSize]);
  const pointerTime = (button: HTMLButtonElement, x: number) => {
    const bounds = button.getBoundingClientRect();
    return bounds.width > 0 ? Math.min(1, Math.max(0, (x - bounds.left) / bounds.width)) * duration : 0;
  };
  return (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
      <span className="truncate text-xs text-[var(--app-text-secondary)]" title={label}>{label}</span>
      <div ref={root} data-replay-track={trackId} className={`replay-timeline-track relative min-w-0 ${draggingKey ? dragOver ? "outline outline-1 outline-dashed outline-[var(--app-primary)] bg-[var(--app-primary)]/15" : "outline outline-1 outline-dashed outline-white/20" : ""}`} style={{ height: preferences.timelineTrackHeight }}
        onDragOver={(event) => { if (disabled || !draggingKey) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOver(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
        onDrop={(event) => {
          event.preventDefault(); setDragOver(false);
          if (disabled || !draggingKey) return;
          const key = event.dataTransfer.getData(REPLAY_TRACK_DRAG_TYPE);
          if (key === draggingKey) onAssign(key, trackId);
          onDraggingChange(null);
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
          const first = marker.events[0];
          return <Popover key={first.eventId || `${first.pullTimeMs}-${index}`} trigger={["hover", "click"]} content={(
            <div className="max-h-64 max-w-[360px] space-y-2 overflow-auto">
              {marker.events.map((event, row) => <button type="button" disabled={disabled} key={event.eventId || row}
                className="block w-full rounded-[4px] p-1 text-left hover:bg-[var(--app-border)] disabled:cursor-not-allowed"
                onClick={() => onEventTimeChange(event.pullTimeMs / 1_000, event.kind)}>
                <strong className="block text-xs">{event.spellName} · {eventLabels[event.kind]} · {formatTime(event.pullTimeMs / 1_000)}</strong>
                <span className="block text-xs text-[var(--app-text-secondary)]">{event.sourceName && event.sourceName !== "nil" ? event.sourceName : "未知来源"} → {event.targetName || "未知目标"}</span>
                <span className="block text-xs text-[var(--app-text-secondary)]">{event.spellId > 0 ? `技能 ${event.spellId}` : "死亡事件"}{event.stackCount != null ? ` · ${event.stackCount} 层` : ""}{event.empowerLevel != null ? ` · 蓄力等级 ${event.empowerLevel}` : ""}{event.extraSpellId != null ? ` · 关联技能 ${event.extraSpellId}` : ""} · 点击回看</span>
              </button>)}
            </div>
          )}>
            <button type="button" disabled={disabled} aria-label={`${first.spellName} ${eventLabels[first.kind]} ${formatTime(first.pullTimeMs / 1_000)}${marker.events.length > 1 ? ` 等 ${marker.events.length} 个事件` : ""}`}
              draggable={!disabled && first.spellId > 0}
              onDragStart={(event) => {
                const key = trackOverrideKey(first);
                event.dataTransfer.setData(REPLAY_TRACK_DRAG_TYPE, key);
                event.dataTransfer.effectAllowed = "move";
                onDraggingChange(key);
              }}
              onDragEnd={() => { onDraggingChange(null); setDragOver(false); }}
              className="absolute top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-visible rounded-[3px] border bg-[var(--app-surface)] shadow-sm disabled:cursor-not-allowed"
              style={{ left: `clamp(${iconSize / 2}px, ${marker.percent}%, calc(100% - ${iconSize / 2}px))`, width: iconSize, height: iconSize, borderColor: color }}
              onClick={() => { if (marker.events.length === 1) onEventTimeChange(first.pullTimeMs / 1_000, first.kind); }}>
              <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[2px]"><SkillIcon event={first} metadata={metadata.get(first.spellId)} /></span>
              {marker.events.length > 1 && <span className="absolute -right-1 -top-1 rounded bg-[var(--app-surface)] px-0.5 text-[10px]">{marker.events.length}</span>}
            </button>
          </Popover>;
        })}
        <span className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-[var(--app-primary)]" style={{ left: `${position(preview ?? currentTime, duration)}%` }} />
        {preview !== null && <span className="pointer-events-none absolute -top-3 text-xs tabular-nums text-[var(--app-primary)]" style={{ left: `clamp(0px, ${position(preview, duration)}%, calc(100% - 40px))` }}>{formatTime(preview)}</span>}
      </div>
    </div>
  );
}
