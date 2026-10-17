import { DesktopOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { Badge, Button, theme } from "antd";
import type { LocalRecording } from "@/shared/replay/model";
import { isRecordingPlayable, recordingStatusLabel } from "@/pages/replay/model";

interface RecordingPanelProps {
  recording: LocalRecording;
  retrying: boolean;
  onRetry: () => void;
  source?: "local" | "team";
  canRetry?: boolean;
}

/** 展示当前本机视角的真实录像状态与时间映射摘要。 */
export function RecordingPanel({ recording, retrying, onRetry, source = "local", canRetry = false }: RecordingPanelProps) {
  const { token } = theme.useToken();
  const playable = isRecordingPlayable(recording);
  return (
    <aside className="min-w-0 self-start rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]">
      <div className="border-b border-[var(--app-border)] px-3 py-3">
        <strong className="text-sm font-medium">{source === "team" ? "团队视角" : recording.importedSource ? "导入视角" : "本机视角"}</strong>
        <p className="mt-1 text-xs text-[var(--app-text-secondary)]">{source === "team" ? "来自已授权团队目录" : recording.importedSource ? "从本地录像资料导入" : "当前设备录制"}</p>
      </div>
      <div className="space-y-3 px-3 py-4 text-sm">
        <div className="flex items-center gap-2">
          <DesktopOutlined className="text-[var(--app-primary)]" />
          <span className="min-w-0 flex-1 truncate">{recording.encounterName}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--app-text-secondary)]">播放状态</span>
          <Badge
            status={playable ? "success" : recording.state === "failed" || recording.state === "interrupted" ? "error" : "processing"}
            text={recordingStatusLabel(recording)}
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--app-text-secondary)]">人物名称</span>
          <span className="min-w-0 truncate" title={recording.playerName ?? undefined}>
            {recording.playerName ?? "未识别"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--app-text-secondary)]">团队人数</span>
          <span>{recording.groupSize} 人</span>
        </div>
        {recording.mapping?.hasGap && (
          <div className="flex gap-2 border-t border-[var(--app-border)] pt-3 text-xs leading-5 text-[var(--app-text-secondary)]">
            <ExclamationCircleOutlined className="mt-0.5 shrink-0" style={{ color: token.colorWarning }} />
            <span>{recording.mapping.mediaCalibrated ? "录像存在缺失区间，只能跳转到有画面的时段。" : "录像存在缺失区间，尚无可靠映射，战斗时间跳转已禁用。"}</span>
          </div>
        )}
        {recording.mapping?.clockDiscontinuous && <p className="text-xs" style={{ color: token.colorWarning }}>录制时间发生不连续，暂不能按战斗时间定位。</p>}
        {recording.error && (
          <div className="break-words border-t border-[var(--app-border)] pt-3 text-xs leading-5" style={{ color: token.colorError }}>
            {recording.error}
          </div>
        )}
        {canRetry && (
          <Button size="small" aria-label={source === "team" ? "重试云端处理" : "重试处理"} loading={retrying} onClick={onRetry}>{source === "team" ? "重试云端处理" : "重试处理"}</Button>
        )}
      </div>
    </aside>
  );
}
