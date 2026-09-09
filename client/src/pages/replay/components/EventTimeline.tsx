import { Tooltip, theme } from "antd";
import type { LocalTimelineEvent, LocalTimelineOwner } from "@/features/recording/model";

interface EventTimelineProps {
  currentTime: number;
  duration: number;
  events: LocalTimelineEvent[];
  playerName: string | null;
  success: boolean | null;
  disabled: boolean;
  onTimeChange: (time: number) => void;
}

interface TimelineTrackProps {
  label: string;
  owner: LocalTimelineOwner;
  events: LocalTimelineEvent[];
  currentTime: number;
  duration: number;
  disabled: boolean;
  color: string;
  onTimeChange: (time: number) => void;
}

function formatTime(value: number) {
  const minutes = Math.floor(Math.max(0, value) / 60);
  const seconds = Math.floor(Math.max(0, value) % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function position(time: number, duration: number) {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (time / duration) * 100));
}

function TimelineTrack({
  label,
  owner,
  events,
  currentTime,
  duration,
  disabled,
  color,
  onTimeChange,
}: TimelineTrackProps) {
  const trackEvents = events.filter((event) => event.owner === owner);

  return (
    <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
      <span className="truncate text-xs text-[var(--app-text-secondary)]" title={label}>{label}</span>
      <div className="relative h-9 min-w-0">
        <button
          type="button"
          className="absolute inset-x-0 top-3 h-3 rounded-[3px] bg-[var(--app-border)] disabled:cursor-not-allowed"
          disabled={disabled}
          aria-label={`跳转到${label}时间`}
          onClick={(event) => {
            if (duration <= 0) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
            onTimeChange(ratio * duration);
          }}
        />
        {trackEvents.map((event, index) => {
          const time = event.pullTimeMs / 1_000;
          const kind = event.kind === "castStart" ? "施法开始" : "施法成功";
          return (
            <Tooltip
              key={`${event.pullTimeMs}-${event.spellId}-${event.kind}-${index}`}
              title={`${event.spellName} · ${kind} · ${formatTime(time)}`}
            >
              <button
                type="button"
                className="absolute top-2 z-10 h-5 w-2 -translate-x-1/2 rounded-[2px] border border-white shadow-sm disabled:cursor-not-allowed"
                disabled={disabled}
                aria-label={`${event.spellName} ${kind} ${formatTime(time)}`}
                style={{ left: `${position(time, duration)}%`, backgroundColor: color }}
                onClick={() => onTimeChange(time)}
              />
            </Tooltip>
          );
        })}
        <span
          className="pointer-events-none absolute inset-y-0 z-20 w-px bg-[var(--app-primary)]"
          style={{ left: `${position(currentTime, duration)}%` }}
        />
      </div>
    </div>
  );
}

/** 以 ENCOUNTER_START 为 0:00 展示真实 Boss 与本机玩家施法事件。 */
export function EventTimeline({
  currentTime,
  duration,
  events,
  playerName,
  success,
  disabled,
  onTimeChange,
}: EventTimelineProps) {
  const { token } = theme.useToken();
  const ticks = Array.from({ length: 6 }, (_, index) => (duration * index) / 5);

  return (
    <section className="min-w-0 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm font-medium">战斗时间轴</strong>
        <span className="text-xs tabular-nums text-[var(--app-text-secondary)]">
          当前 {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className="mt-4 grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3">
        <span />
        <div className="grid grid-cols-6 text-xs tabular-nums text-[var(--app-text-secondary)]">
          {ticks.map((tick, index) => (
            <span key={index} className={index === 5 ? "text-right" : index === 0 ? "text-left" : "text-center"}>
              {formatTime(tick)}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        <TimelineTrack
          label="Boss 技能"
          owner="boss"
          events={events}
          currentTime={currentTime}
          duration={duration}
          disabled={disabled}
          color={token.colorWarning}
          onTimeChange={onTimeChange}
        />
        <TimelineTrack
          label={playerName ?? "个人技能"}
          owner="player"
          events={events}
          currentTime={currentTime}
          duration={duration}
          disabled={disabled}
          color={token.colorPrimary}
          onTimeChange={onTimeChange}
        />
      </div>
      <div className="mt-3 flex items-center justify-between pl-[100px] text-xs text-[var(--app-text-secondary)]">
        <span>开战 0:00</span>
        <span>{success === true ? "击杀" : success === false ? "战斗结束" : "结束"} {formatTime(duration)}</span>
      </div>
    </section>
  );
}
