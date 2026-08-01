import { DesktopOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Segmented, Select, Switch, Tooltip } from "antd";
import type { ObsVideoSettings } from "@/features/obs/model";
import { ObsSection } from "@/features/obs/ObsSection";

interface ObsVideoSettingsPanelProps {
  connected: boolean;
  video: ObsVideoSettings;
  onVideoChange: (video: ObsVideoSettings) => void;
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
  onVideoChange,
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
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-center gap-x-8 gap-y-7 max-[1600px]:grid-cols-1">
        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5">
          <label className="text-sm">分辨率</label>
          <div className="flex min-w-0 items-center gap-3">
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
        </div>
        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5">
          <label className="text-sm">编码器</label>
          <Select
            className="min-w-0"
            value={video.encoderId || "loading"}
            options={[{ label: video.encoderName, value: video.encoderId || "loading" }]}
            disabled
          />
        </div>

        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5">
          <label className="text-sm">编码方式</label>
          <Segmented
            block
            value={hardwareEncoder ? "GPU" : "CPU"}
            options={["GPU", "CPU"]}
            disabled
          />
        </div>
        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5">
          <label className="text-sm">捕捉模式</label>
          <Segmented
            block
            value="game"
            options={[
              { label: "游戏捕捉", value: "game" },
              { label: "窗口捕捉", value: "window" },
            ]}
            disabled
          />
        </div>

        <div className="col-span-2 grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5 max-[1600px]:col-span-1">
          <label className="text-sm">自动捕捉</label>
          <div className="flex items-center gap-3">
            <Switch
              checked
              disabled
            />
            <span className="text-sm">自动捕捉 WoW 窗口</span>
            <Tooltip title="由客户端自动检测并绑定正在运行的 Wow.exe。">
              <InfoCircleOutlined className="text-[var(--app-primary)]" />
            </Tooltip>
          </div>
        </div>

        <div className="col-span-2 grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5 max-[1600px]:col-span-1">
          <label className="text-sm">目标程序</label>
          <Select
            className="min-w-0"
            value="Wow.exe"
            options={[
              {
                label: "自动识别魔兽世界游戏窗口",
                value: "Wow.exe",
              },
            ]}
            disabled
          />
        </div>
      </div>
    </ObsSection>
  );
}
