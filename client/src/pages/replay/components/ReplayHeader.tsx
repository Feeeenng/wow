import { CalendarOutlined, ClockCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Select, Tag, Tooltip } from "antd";
import type { LocalRecording } from "@/shared/replay/model";
import { ReplayCloudUploadButton } from "@/pages/replay/components/ReplayCloudUploadButton";
import { WclReportButton } from "@/pages/replay/components/WclReportButton";
import {
  formatDifficulty,
  formatRecordingTime,
  recordingDurationSeconds,
  recordingStatusLabel,
} from "@/pages/replay/model";

interface ReplayHeaderProps {
  recording: LocalRecording | null;
  recordings: LocalRecording[];
  selectedPullId: string | null;
  refreshing: boolean;
  onRecordingChange: (pullId: string) => void;
  onRefresh: () => void;
  onImport: () => void;
  source: "local" | "team";
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
  onImport,
  source,
}: ReplayHeaderProps) {
  const options = recordings.map((item) => ({
    value: item.pullId,
    label: `${formatRecordingTime(item.encounterStartUnixMs)} · ${item.encounterName} · ${recordingStatusLabel(item)}`,
  }));

  return (
    <section className="replay-header">
      <div className="replay-header-title">
        <strong>{recording?.encounterName ?? "录像回放"}</strong>
        {recording && <span>{formatDifficulty(recording.difficultyId)} · {recording.playerName ?? "本机视角"}</span>}
      </div>
      <div className="replay-header-controls">
        {source === "local" && <ReplayCloudUploadButton recording={recording} />}
        {source === "team" && <WclReportButton recording={recording} recordings={recordings} onPublished={onRefresh} />}
        <Button size="small" onClick={onImport}>导入录像</Button>
        <div className="replay-quick-select">
          <Select
            className="min-w-0 flex-1"
            aria-label={source === "team" ? "选择团队录像" : "选择本地录像"}
            options={options}
            value={selectedPullId}
            placeholder={source === "team" ? "选择一场团队录像" : "选择一场本地 Boss 录像"}
            onChange={onRecordingChange}
          />
          <Tooltip title={source === "team" ? "刷新团队录像" : "刷新本地录像"}>
            <Button
              icon={<ReloadOutlined spin={refreshing} />}
              aria-label={source === "team" ? "刷新团队录像" : "刷新本地录像"}
              onClick={onRefresh}
            />
          </Tooltip>
        </div>
        {recording && (
          <div className="replay-header-status">
            <Tag color={recording.success === true ? "success" : recording.success === false ? "error" : "default"}>
              {recording.success === true ? "已击杀" : recording.success === false ? "未击杀" : "结果未知"}
            </Tag>
            <Tag color={stateColor(recording)}>{recordingStatusLabel(recording)}</Tag>
          </div>
        )}
      </div>
      <div className="replay-header-meta">
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
