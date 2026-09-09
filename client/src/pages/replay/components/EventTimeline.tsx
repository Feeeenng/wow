import { CheckCircleOutlined, CloseCircleOutlined, FlagOutlined } from "@ant-design/icons";
import { Tooltip, theme } from "antd";

interface EventTimelineProps {
  currentTime: number;
  duration: number;
  encounterStartTime: number;
  encounterEndTime: number;
  success: boolean | null;
  disabled: boolean;
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

/** 展示 CombatLog 映射出的开战、结束和当前播放位置。 */
export function EventTimeline({
  currentTime,
  duration,
  encounterStartTime,
  encounterEndTime,
  success,
  disabled,
  onTimeChange,
}: EventTimelineProps) {
  const { token } = theme.useToken();
  const ticks = Array.from({ length: 6 }, (_, index) => (duration * index) / 5);
  const endColor = success === true ? token.colorSuccess : success === false ? token.colorError : token.colorTextSecondary;

  const seekFromPointer = (clientX: number, element: HTMLButtonElement) => {
    if (disabled || duration <= 0) return;
    const bounds = element.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    onTimeChange(ratio * duration);
  };

  return (
    <section className="min-w-0 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <strong className="text-sm font-medium">战斗时间轴</strong>
        <span className="text-xs tabular-nums text-[var(--app-text-secondary)]">
          当前 {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-6 text-xs tabular-nums text-[var(--app-text-secondary)]">
        {ticks.map((tick, index) => (
          <span key={index} className={index === 5 ? "text-right" : index === 0 ? "text-left" : "text-center"}>
            {formatTime(tick)}
          </span>
        ))}
      </div>
      <div className="relative mt-3 h-12">
        <button
          className="absolute inset-x-0 top-4 h-3 rounded-[3px] bg-[var(--app-border)] disabled:cursor-not-allowed"
          type="button"
          disabled={disabled}
          aria-label="跳转到录像时间"
          onClick={(event) => seekFromPointer(event.clientX, event.currentTarget)}
        >
          <span
            className="absolute inset-y-0 rounded-[3px] bg-[color-mix(in_srgb,var(--app-primary)_28%,transparent)]"
            style={{
              left: `${position(encounterStartTime, duration)}%`,
              right: `${100 - position(encounterEndTime, duration)}%`,
            }}
          />
        </button>
        <Tooltip title={`开战 · ${formatTime(encounterStartTime)}`}>
          <button
            className="absolute top-0 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-[4px] border bg-[var(--app-surface)] shadow-sm disabled:cursor-not-allowed"
            type="button"
            disabled={disabled}
            style={{ left: `${position(encounterStartTime, duration)}%`, borderColor: token.colorPrimary, color: token.colorPrimary }}
            aria-label={`跳转到开战 ${formatTime(encounterStartTime)}`}
            onClick={() => onTimeChange(encounterStartTime)}
          >
            <FlagOutlined />
          </button>
        </Tooltip>
        <Tooltip title={`${success === true ? "击杀" : success === false ? "战斗结束" : "结束"} · ${formatTime(encounterEndTime)}`}>
          <button
            className="absolute top-0 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-[4px] border bg-[var(--app-surface)] shadow-sm disabled:cursor-not-allowed"
            type="button"
            disabled={disabled}
            style={{ left: `${position(encounterEndTime, duration)}%`, borderColor: endColor, color: endColor }}
            aria-label={`跳转到战斗结束 ${formatTime(encounterEndTime)}`}
            onClick={() => onTimeChange(encounterEndTime)}
          >
            {success === false ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
          </button>
        </Tooltip>
        <span
          className="pointer-events-none absolute bottom-1 top-0 z-20 w-px bg-[var(--app-primary)]"
          style={{ left: `${position(currentTime, duration)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--app-text-secondary)]">
        <span>前置画面</span>
        <span>Boss 战斗</span>
        <span>结束画面</span>
      </div>
    </section>
  );
}
