import { DesktopOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { Segmented, Select, Switch, Tooltip } from "antd";
import type { ObsCaptureSettings, ObsSelectOption, ObsVideoSettings } from "@/features/obs/model";
import { ObsSection } from "@/features/obs/ObsSection";

interface ObsVideoSettingsPanelProps {
  connected: boolean;
  video: ObsVideoSettings;
  capture: ObsCaptureSettings;
  onVideoChange: (video: ObsVideoSettings) => void;
  onCaptureChange: (capture: ObsCaptureSettings) => void;
}

const resolutions = [
  { label: "1920×1080 (16:9)", value: "1920x1080" },
  { label: "2560×1440 (16:9)", value: "2560x1440" },
  { label: "3840×2160 (16:9)", value: "3840x2160" },
];

/** 按参考图展示 OBS 画面、编码和捕捉设置。 */
export function ObsVideoSettingsPanel({
  connected,
  video,
  capture,
  onVideoChange,
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
  const encoderMode = (encoder: ObsSelectOption) => (
    /x264|软件|aom|svt/i.test(`${encoder.id} ${encoder.name}`) ? "CPU" : "GPU"
  );
  const currentEncoder = video.encoders.find((encoder) => encoder.id === video.encoderId);
  const currentEncoderMode = currentEncoder ? encoderMode(currentEncoder) : "CPU";
  const encoderModes = ["GPU", "CPU"].filter((mode) => (
    video.encoders.some((encoder) => encoderMode(encoder) === mode)
  ));
  const updateEncoder = (encoderId: string) => {
    const encoder = video.encoders.find((option) => option.id === encoderId);
    if (!encoder) {
      return;
    }
    onVideoChange({
      ...video,
      encoderId: encoder.id,
      encoderName: encoder.name,
    });
  };

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
            value={video.encoderId || undefined}
            options={video.encoders.map((encoder) => ({
              label: encoder.name,
              value: encoder.id,
            }))}
            placeholder="从 OBS 获取"
            onChange={updateEncoder}
            disabled={!connected || video.encoders.length === 0}
          />
        </div>

        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5">
          <label className="text-sm">编码方式</label>
          <Segmented
            block
            value={currentEncoder ? currentEncoderMode : undefined}
            options={encoderModes.length > 0
              ? encoderModes
              : [{ label: "从 OBS 获取", value: "pending", disabled: true }]}
            onChange={(mode) => {
              const encoder = video.encoders.find((option) => encoderMode(option) === mode);
              if (encoder) {
                updateEncoder(encoder.id);
              }
            }}
            disabled={!connected || encoderModes.length === 0}
          />
        </div>
        <div className="grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5">
          <label className="text-sm">捕捉模式</label>
          <Segmented
            block
            value={capture.inputKinds.some((kind) => kind.id === capture.inputKind)
              ? capture.inputKind
              : undefined}
            options={capture.inputKinds.length > 0
              ? capture.inputKinds.map((kind) => ({
                label: kind.name,
                value: kind.id,
              }))
              : [{ label: "从 OBS 获取", value: "pending", disabled: true }]}
            onChange={(inputKind) => {
              const nextInputKind = String(inputKind);
              onCaptureChange({
                ...capture,
                inputKind: nextInputKind,
                autoCapture: nextInputKind === "game_capture",
                window: null,
              });
            }}
            disabled={!connected || capture.inputKinds.length === 0}
          />
        </div>

        <div className="col-span-2 grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5 max-[1600px]:col-span-1">
          <label className="text-sm">自动捕捉</label>
          <Switch
            className="justify-self-start"
            checked={capture.autoCapture}
            onChange={(autoCapture) => onCaptureChange({
              ...capture,
              autoCapture,
            })}
            disabled={!connected || capture.inputKind !== "game_capture"}
          />
        </div>

        <div className="col-span-2 grid grid-cols-[82px_minmax(0,1fr)] items-center gap-x-5 max-[1600px]:col-span-1">
          <label className="text-sm">
            {capture.inputKind === "monitor_capture" ? "目标屏幕" : "目标程序"}
          </label>
          <Select
            className="min-w-0"
            value={capture.window}
            options={capture.windows.map((windowOption) => ({
              label: windowOption.name,
              value: windowOption.id,
            }))}
            placeholder={capture.inputKind === "monitor_capture"
              ? "未检测到可捕捉屏幕"
              : "未检测到魔兽世界窗口"}
            onChange={(window) => onCaptureChange({
              ...capture,
              autoCapture: false,
              window,
            })}
            disabled={!connected || capture.windows.length === 0}
          />
        </div>
      </div>
    </ObsSection>
  );
}
