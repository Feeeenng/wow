import { CalendarOutlined, ClockCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Select, Tag, Tooltip } from "antd";
import type { LocalRecording } from "@/features/recording/model";
import {
  formatDifficulty,
  formatRecordingTime,
  recordingDurationSeconds,
  recordingStateLabel,
} from "@/pages/replay/model";

interface ReplayHeaderProps {
  recording: LocalRecording | null;
  recordings: LocalRecording[];
  selectedPullId: string | null;
  refreshing: boolean;
  onRecordingChange: (pullId: string) => void;
  onRefresh: () => void;
}

function formatDuration(duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function stateColor(recording: LocalRecording) {
  if (recording.state === "ready") return "success";
  if (recording.state === "partial") return "warning";
  if (recording.state === "failed" || recording.state === "interrupted") return "error";
  return "processing";
}

/** 展示当前本地 Pull 元信息并提供录像选择和刷新入口。 */
export function ReplayHeader({
  recording,
  recordings,
  selectedPullId,
  refreshing,
  onRecordingChange,
  onRefresh,
}: ReplayHeaderProps) {
  const options = recordings.map((item) => ({
    value: item.pullId,
    label: `${formatRecordingTime(item.encounterStartUnixMs)} · ${item.encounterName} · ${recordingStateLabel(item.state)}`,
  }));

  return (
    <section className="flex min-h-16 min-w-0 flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex min-w-[320px] max-w-[620px] flex-1 items-center gap-2">
          <Select
            className="min-w-0 flex-1"
            aria-label="选择本地录像"
            options={options}
            value={selectedPullId}
            placeholder="选择一场本地 Boss 录像"
            onChange={onRecordingChange}
          />
          <Tooltip title="刷新本地录像">
            <Button
              icon={<ReloadOutlined spin={refreshing} />}
              aria-label="刷新本地录像"
              onClick={onRefresh}
            />
          </Tooltip>
        </div>
        {recording && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <strong className="font-medium">{recording.encounterName}</strong>
            <Tag color="processing">{formatDifficulty(recording.difficultyId)}</Tag>
            <Tag color={recording.success === true ? "success" : recording.success === false ? "error" : "default"}>
              {recording.success === true ? "已击杀" : recording.success === false ? "未击杀" : "结果未知"}
            </Tag>
            <Tag color={stateColor(recording)}>{recordingStateLabel(recording.state)}</Tag>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-4 text-xs text-[var(--app-text-secondary)]">
        <span className="flex items-center gap-1.5">
          <CalendarOutlined />
          {recording ? formatRecordingTime(recording.encounterStartUnixMs) : "暂无日期"}
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <ClockCircleOutlined />
          {recording ? formatDuration(recordingDurationSeconds(recording)) : "--:--"}
        </span>
      </div>
    </section>
  );
}
