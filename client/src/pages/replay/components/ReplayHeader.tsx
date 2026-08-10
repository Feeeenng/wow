import { ClockCircleOutlined, CalendarOutlined } from "@ant-design/icons";
import { Select, Tag } from "antd";
import type { ReplayFixture } from "@/pages/replay/model";

interface ReplayHeaderProps {
  replay: ReplayFixture | null;
  replayOptions: ReplayFixture[];
  selectedReplayId: string | null;
  onReplayChange: (replayId: string | null) => void;
}

function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** 展示当前 Pull 元信息并提供回放选择入口。 */
export function ReplayHeader({
  replay,
  replayOptions,
  selectedReplayId,
  onReplayChange,
}: ReplayHeaderProps) {
  const options = [
    ...replayOptions.map((item) => ({
      value: item.id,
      label: `${item.instance} · ${item.boss} · ${item.pullLabel}`,
    })),
    { value: "empty", label: "暂无可用回放" },
  ];

  return (
    <section className="flex min-h-16 min-w-0 flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
        <Select
          className="min-w-[290px] max-w-[460px] flex-1"
          aria-label="选择回放"
          options={options}
          value={selectedReplayId ?? "empty"}
          onChange={(value) => onReplayChange(value === "empty" ? null : value)}
        />
        {replay && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <strong className="font-medium">{replay.boss}</strong>
            <Tag color="processing">{replay.difficulty}</Tag>
            <span className="text-[var(--app-text-secondary)]">{replay.pullLabel}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-4 text-xs text-[var(--app-text-secondary)]">
        <span className="flex items-center gap-1.5">
          <CalendarOutlined />
          {replay?.date ?? "暂无日期"}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <ClockCircleOutlined />
          {replay ? formatDuration(replay.durationSeconds) : "--:--"}
        </span>
      </div>
    </section>
  );
}
