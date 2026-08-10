import {
  AlertOutlined,
  FireOutlined,
  HeartOutlined,
  MinusSquareOutlined,
  PlusSquareOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Tabs, Tooltip, theme } from "antd";
import type { ComponentType } from "react";
import type { TimelineTrack, TimelineTrackKind } from "@/pages/replay/model";

interface EventTimelineProps {
  tracks: TimelineTrack[];
  currentTime: number;
  duration: number;
  onTimeChange: (time: number) => void;
}

const trackIcons: Record<TimelineTrackKind, ComponentType> = {
  damage: FireOutlined,
  healing: HeartOutlined,
  buff: PlusSquareOutlined,
  debuff: MinusSquareOutlined,
  "raid-cooldown": SafetyCertificateOutlined,
  boss: AlertOutlined,
};

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** 展示统一 Pull 时间轨道，点击事件后同步页面演示时间与游标。 */
export function EventTimeline({ tracks, currentTime, duration, onTimeChange }: EventTimelineProps) {
  const { token } = theme.useToken();
  const trackColors: Record<TimelineTrackKind, string> = {
    damage: token.colorError,
    healing: token.colorSuccess,
    buff: token.colorPrimary,
    debuff: token.colorTextSecondary,
    "raid-cooldown": token.colorWarning,
    boss: token.colorErrorActive,
  };
  const tickCount = 6;
  const ticks = Array.from({ length: tickCount }, (_, index) => (duration * index) / (tickCount - 1));
  const cursorPosition = `${(currentTime / duration) * 100}%`;

  const tabItems = [
    { key: "timeline", label: "事件时间轴" },
    { key: "damage", label: "伤害分析", disabled: true },
    { key: "healing", label: "治疗分析", disabled: true },
    { key: "resources", label: "资源分析", disabled: true },
    { key: "casts", label: "施法统计", disabled: true },
  ];

  return (
    <section className="min-w-0 overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]">
      <Tabs
        className="[&_.ant-tabs-nav]:!mb-0 [&_.ant-tabs-nav]:!px-4"
        activeKey="timeline"
        items={tabItems}
      />
      <div className="min-w-0 px-4 pb-4 pt-3">
        <div className="ml-[108px] grid grid-cols-6 text-xs tabular-nums text-[var(--app-text-secondary)]">
          {ticks.map((tick, index) => (
            <span
              key={tick}
              className={index === ticks.length - 1 ? "text-right" : index === 0 ? "text-left" : "text-center"}
            >
              {formatTime(tick)}
            </span>
          ))}
        </div>
        <div className="mt-2 min-w-0">
          {tracks.map((track) => {
            const TrackIcon = trackIcons[track.kind];
            const color = trackColors[track.kind];
            return (
              <div key={track.kind} className="grid min-h-10 grid-cols-[100px_minmax(0,1fr)] items-stretch gap-2 border-t border-[var(--app-border)] first:border-t-0">
                <div className="flex items-center gap-2 truncate text-xs font-medium" style={{ color }}>
                  <TrackIcon />
                  <span className="truncate">{track.label}</span>
                </div>
                <div className="relative min-w-0">
                  <div className="absolute inset-y-0 left-0 right-0 grid grid-cols-5">
                    {Array.from({ length: 5 }, (_, index) => (
                      <span key={index} className="border-l border-dashed border-[var(--app-border)] first:border-l-0" />
                    ))}
                  </div>
                  {track.events.map((event) => (
                    <Tooltip key={event.id} title={`${formatTime(event.time)} · ${event.label}`}>
                      <button
                        className="absolute top-1/2 z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[4px] border bg-[var(--app-surface)] text-[10px] font-medium shadow-sm transition-transform hover:scale-110 focus-visible:z-20"
                        type="button"
                        style={{ left: `${(event.time / duration) * 100}%`, borderColor: color, color }}
                        aria-label={`${formatTime(event.time)} ${event.label}`}
                        onClick={() => onTimeChange(event.time)}
                      >
                        {event.shortLabel}
                      </button>
                    </Tooltip>
                  ))}
                  <span
                    className="pointer-events-none absolute inset-y-0 z-20 w-px bg-[var(--app-primary)]"
                    style={{ left: cursorPosition }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="ml-[108px] mt-2 flex items-center gap-2 text-xs text-[var(--app-text-secondary)]">
          <span className="h-2 w-2 rounded-full bg-[var(--app-primary)]" />
          当前演示时间 {formatTime(currentTime)}
        </div>
      </div>
    </section>
  );
}
