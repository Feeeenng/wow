import { DesktopOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { Badge, theme } from "antd";
import type { LocalRecording } from "@/features/recording/model";
import {
  encounterStartVideoSeconds,
  isRecordingPlayable,
  recordingStateLabel,
} from "@/pages/replay/model";

interface RecordingPanelProps {
  recording: LocalRecording;
}

function formatOffset(seconds: number) {
  return `${seconds.toFixed(1)} 秒`;
}

/** 展示当前本机视角的真实录像状态与时间映射摘要。 */
export function RecordingPanel({ recording }: RecordingPanelProps) {
  const { token } = theme.useToken();
  const playable = isRecordingPlayable(recording);
  return (
    <aside className="min-w-0 self-start rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)]">
      <div className="border-b border-[var(--app-border)] px-3 py-3">
        <strong className="text-sm font-medium">本机视角</strong>
        <p className="mt-1 text-xs text-[var(--app-text-secondary)]">当前设备录制</p>
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
            text={recordingStateLabel(recording.state)}
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--app-text-secondary)]">开战位置</span>
          <span className="tabular-nums">{recording.mapping ? formatOffset(encounterStartVideoSeconds(recording)) : "待生成"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-[var(--app-text-secondary)]">团队人数</span>
          <span>{recording.groupSize} 人</span>
        </div>
        {recording.mapping?.hasGap && (
          <div className="flex gap-2 border-t border-[var(--app-border)] pt-3 text-xs leading-5 text-[var(--app-text-secondary)]">
            <ExclamationCircleOutlined className="mt-0.5 shrink-0" style={{ color: token.colorWarning }} />
            <span>录像存在缺失区间，战斗边界跳转已禁用。</span>
          </div>
        )}
        {recording.error && (
          <div className="break-words border-t border-[var(--app-border)] pt-3 text-xs leading-5" style={{ color: token.colorError }}>
            {recording.error}
          </div>
        )}
      </div>
    </aside>
  );
}
