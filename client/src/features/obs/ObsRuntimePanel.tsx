import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudServerOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Button, Progress, Tag, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { ObsInstallationStatus, ObsStatus } from "@/features/obs/model";
import { ObsSection } from "@/features/obs/ObsSection";

interface ObsRuntimePanelProps {
  status: ObsStatus;
  installation: ObsInstallationStatus;
  busyAction: string | null;
  onInstall: () => void;
  onRefresh: () => void;
  onOpenRecordDirectory: () => void;
  onToggleRecording: () => void;
  onToggleLive: () => void;
}

interface StatusRowProps {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}

const formatRuntime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, "0")).join(":");
};

const StatusRow = ({ icon, label, children }: StatusRowProps) => (
  <div className="grid min-h-12 grid-cols-[22px_92px_minmax(0,1fr)] items-center gap-2 border-b border-[var(--app-border)] last:border-b-0">
    <span className="text-[var(--app-primary)]">{icon}</span>
    <span className="text-sm">{label}</span>
    <div className="min-w-0 text-right text-sm">{children}</div>
  </div>
);

/** 展示录制前置条件，并根据安装状态切换下载或检测界面。 */
export function ObsRuntimePanel({
  status,
  installation,
  busyAction,
  onInstall,
  onRefresh,
  onOpenRecordDirectory,
  onToggleRecording,
  onToggleLive,
}: ObsRuntimePanelProps) {
  const healthy = status.connected && status.ready;

  return (
    <div className="space-y-4">
      <ObsSection
        title="OBS 监听与运行状态"
        extra={<Tag color={healthy ? "success" : "warning"}>{healthy ? "运行正常" : "待配置"}</Tag>}
      >
        <StatusRow icon={<CloudServerOutlined />} label="OBS 连接状态">
          <span className={status.connected ? "text-emerald-600" : "text-gray-400"}>
            ● {status.connected ? "已连接" : installation.installed ? "正在启动" : "尚未安装"}
          </span>
        </StatusRow>
        <StatusRow icon={<ClockCircleOutlined />} label="OBS 运行时长">
          {formatRuntime(status.runtimeSeconds)}
        </StatusRow>
        <StatusRow icon={<VideoCameraOutlined />} label="当前状态">
          <Tooltip title={status.readinessMessage}>
            <div className="flex flex-wrap justify-end gap-1">
              {status.recordingActive && <Tag color="success" className="m-0">录制中</Tag>}
              {status.liveActive && <Tag color="error" className="m-0">直播中</Tag>}
                {!status.recordingActive && !status.liveActive && (
                  <Tag color={healthy ? "processing" : "default"} className="m-0">
                    {healthy
                      ? status.liveReady
                        ? "可以录制或直播"
                        : "可以录制"
                      : "配置未完成"}
                  </Tag>
                )}
            </div>
          </Tooltip>
        </StatusRow>
        <StatusRow icon={<FolderOpenOutlined />} label="输出位置">
          <button
            type="button"
            className="max-w-full truncate text-[var(--app-primary)] disabled:text-gray-400"
            title={status.outputDirectory ?? "尚未获取"}
            disabled={!status.outputDirectory}
            onClick={onOpenRecordDirectory}
          >
            {status.outputDirectory ?? "尚未获取"}
          </button>
        </StatusRow>
        <div className="grid grid-cols-2 gap-2 pt-4">
          <Button
            danger={status.recordingActive}
            type="primary"
            size="large"
            icon={status.recordingActive ? <StopOutlined /> : <PlayCircleOutlined />}
            loading={busyAction === "recording"}
            disabled={
              !status.connected
              || status.liveActive
              || (!status.captureReady && !status.recordingActive)
              || (!status.ready && !status.recordingActive)
            }
            onClick={onToggleRecording}
          >
            {status.recordingActive ? "停止录制" : "开始测试录制"}
          </Button>
          <Button
            danger={status.liveActive}
            type="primary"
            size="large"
            title={status.liveReadinessMessage}
            icon={status.liveActive ? <StopOutlined /> : <VideoCameraOutlined />}
            loading={busyAction === "live"}
            disabled={
              !status.connected
              || (!status.liveReady && !status.liveActive)
            }
            onClick={onToggleLive}
          >
            {status.liveActive ? "停止直播" : "开始直播"}
          </Button>
        </div>
      </ObsSection>

      {installation.installed ? (
        <ObsSection
          title="OBS 状态检测"
          extra={<CheckCircleFilled className="text-emerald-500" />}
        >
          <StatusRow icon={<CheckCircleFilled />} label="安装状态">
            <span className="text-emerald-600">已安装</span>
          </StatusRow>
          <StatusRow icon={<CloudServerOutlined />} label="运行状态">
            <span className={status.connected ? "text-emerald-600" : "text-gray-400"}>
              {status.connected ? "运行中" : "正在启动"}
            </span>
          </StatusRow>
          <StatusRow icon={<SafetyCertificateOutlined />} label="配置状态">
            <span className={status.ready ? "text-emerald-600" : "text-gray-400"}>
              {status.ready ? "检测通过" : "等待检测"}
            </span>
          </StatusRow>
          <Button
            className="mt-4"
            block
            icon={<ReloadOutlined />}
            loading={busyAction === "refresh"}
            onClick={onRefresh}
          >
            重新检测
          </Button>
        </ObsSection>
      ) : (
        <ObsSection title="OBS 下载与安装">
          <div className="flex items-center justify-between text-sm">
            <span>OBS Studio</span>
            <span>{installation.expectedVersion}（64 位）</span>
          </div>
          <p className="mb-4 mt-3 text-sm text-[var(--app-text-secondary)]">
            未检测到 OBS Studio，点击下方按钮即可自动完成安装。
          </p>
          {installation.installing && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-[var(--app-text-secondary)]">{installation.installPhase}</span>
                <span className="font-medium text-[var(--app-primary)]">
                  {installation.progressPercent}%
                </span>
              </div>
              <Progress
                percent={installation.progressPercent}
                showInfo={false}
                status="active"
                strokeColor="var(--app-primary)"
              />
            </div>
          )}
          <Button
            block
            type="primary"
            size="large"
            icon={<DownloadOutlined />}
            loading={busyAction === "install" || installation.installing}
            disabled={installation.installing}
            onClick={onInstall}
          >
            {installation.installing ? "正在安装 OBS" : "下载并安装 OBS"}
          </Button>
        </ObsSection>
      )}
    </div>
  );
}
