import { DesktopOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Segmented, Select, Switch, Tooltip } from "antd";
import type { ObsVideoSettings } from "@/features/obs/model";
import { ObsSection } from "@/features/obs/ObsSection";

interface ObsVideoSettingsPanelProps {
  connected: boolean;
  video: ObsVideoSettings;
  captureAnyFullscreen: boolean;
  onVideoChange: (video: ObsVideoSettings) => void;
  onCaptureModeChange: (value: boolean) => void;
  onCaptureChange: (captureAnyFullscreen: boolean) => void;
}

const resolutions = [
  { label: "1920×1080 (16:9)", value: "1920x1080" },
  { label: "2560×1440 (16:9)", value: "2560x1440" },
  { label: "3840×2160 (16:9)", value: "3840x2160" },
];

/** 按参考图展示 OBS 画面、编码和游戏捕捉设置。 */
export function ObsVideoSettingsPanel({
  connected,
  video,
  captureAnyFullscreen,
  onVideoChange,
  onCaptureModeChange,
  onCaptureChange,
}: ObsVideoSettingsPanelProps) {
  const updateResolution = (value: string) => {
    const [width, height] = value.split("x").map(Number);
    onVideoChange({
      ...video,
      baseWidth: width,
      baseHeight: height,
      outputWidth: width,
      outputHeight: height,
    });
  };
  const hardwareEncoder = !/x264|软件/i.test(`${video.encoderId} ${video.encoderName}`);

  return (
    <ObsSection
      title={(
        <span className="inline-flex items-center gap-3">
          <DesktopOutlined className="text-lg" />
          A. 画面与捕捉
        </span>
      )}
    >
      <div className="grid grid-cols-[82px_minmax(180px,1fr)_82px_minmax(180px,1fr)] items-center gap-x-5 gap-y-7">
        <label className="text-sm">分辨率</label>
        <div className="flex items-center gap-3">
          <Select
            className="min-w-0 flex-1"
            value={`${video.outputWidth}x${video.outputHeight}`}
            options={resolutions}
            onChange={updateResolution}
            disabled={!connected}
          />
          <Tooltip title="默认使用 1920×1080，可按设备性能提高分辨率。">
            <InfoCircleOutlined className="text-[var(--app-primary)]" />
          </Tooltip>
        </div>
        <label className="text-sm">编码器</label>
        <Select
          value={video.encoderId || "loading"}
          options={[{ label: video.encoderName, value: video.encoderId || "loading" }]}
          disabled
        />

        <label className="text-sm">编码方式</label>
        <Segmented
          block
          value={hardwareEncoder ? "GPU" : "CPU"}
          options={["GPU", "CPU"]}
          disabled
        />
        <label className="text-sm">捕捉模式</label>
        <Segmented
          block
          value={captureAnyFullscreen ? "game" : "window"}
          options={[
            { label: "游戏捕捉", value: "game" },
            { label: "窗口捕捉", value: "window" },
          ]}
          onChange={(value) => {
            const automatic = value === "game";
            onCaptureModeChange(automatic);
            onCaptureChange(automatic);
          }}
          disabled={!connected}
        />

        <label className="text-sm">自动捕捉</label>
        <div className="col-span-3 flex items-center gap-3">
          <Switch
            checked={captureAnyFullscreen}
            onChange={(checked) => {
              onCaptureModeChange(checked);
              onCaptureChange(checked);
            }}
            disabled={!connected}
          />
          <span className="text-sm">自动捕捉 WoW 窗口</span>
          <Tooltip title="关闭后会从 OBS 可捕捉窗口中选择正在运行的 Wow.exe。">
            <InfoCircleOutlined className="text-[var(--app-primary)]" />
          </Tooltip>
        </div>

        <label className="text-sm">目标程序</label>
        <Select
          className="col-span-3"
          value={captureAnyFullscreen ? "auto" : "Wow.exe"}
          options={[
            {
              label: captureAnyFullscreen ? "自动识别魔兽世界游戏窗口" : "Wow.exe",
              value: captureAnyFullscreen ? "auto" : "Wow.exe",
            },
          ]}
          disabled
        />
      </div>
    </ObsSection>
  );
}
