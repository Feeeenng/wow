import { AudioOutlined, CustomerServiceOutlined, SoundOutlined } from "@ant-design/icons";
import { Badge, Checkbox, Select, Slider, Tooltip } from "antd";
import type { ComponentType } from "react";
import type { ObsAudioInput } from "@/features/obs/model";
import { ObsSection } from "@/features/obs/ObsSection";

interface ObsAudioSettingsPanelProps {
  connected: boolean;
  inputs: ObsAudioInput[];
  onChange: (name: string, enabled: boolean, volume: number, sourceId?: string) => void;
}

interface AudioChannel {
  kind: ObsAudioInput["kind"];
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const audioChannels: AudioChannel[] = [
  { kind: "game", label: "游戏声音", icon: CustomerServiceOutlined },
  { kind: "desktop", label: "耳机 / 扬声器", icon: SoundOutlined },
  { kind: "microphone", label: "麦克风", icon: AudioOutlined },
];

/** 未连接时保留灰色通道结构，连接后只展示 OBS 返回的设备和状态。 */
export function ObsAudioSettingsPanel({ connected, inputs, onChange }: ObsAudioSettingsPanelProps) {
  return (
    <ObsSection
      title={(
        <span className="inline-flex items-center gap-3">
          <SoundOutlined className="text-lg" />
          B. 声音设置
        </span>
      )}
    >
      <div className="space-y-5">
        {audioChannels.map((channel) => {
          const input = inputs.find((candidate) => candidate.kind === channel.kind);
          const detected = connected && Boolean(input);
          const Icon = channel.icon;
          const volume = input?.volumePercent ?? 0;
          return (
            <div
              className={`grid grid-cols-[132px_minmax(130px,1fr)_minmax(90px,0.7fr)_40px_100px] items-center gap-3 ${detected ? "" : "text-gray-400"}`}
              key={channel.kind}
            >
              <Checkbox
                checked={input?.enabled ?? false}
                disabled={!detected}
                onChange={(event) => {
                  if (input) {
                    onChange(input.name, event.target.checked, input.volumePercent, input.sourceId);
                  }
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className={detected ? "text-[var(--app-primary)]" : "text-gray-400"} />
                  {channel.label}
                  <Badge status={detected ? "success" : "default"} />
                </span>
              </Checkbox>
              <Select
                value={input?.sourceId || undefined}
                placeholder={detected ? "未检测到可用设备" : "自动检测设备"}
                options={input?.sources.map((source) => ({ label: source.name, value: source.id })) ?? []}
                disabled={!detected || input?.sources.length === 0}
                onChange={(sourceId) => {
                  if (input) {
                    onChange(input.name, input.enabled, input.volumePercent, sourceId);
                  }
                }}
              />
              <Slider
                value={volume}
                disabled={!detected || !input?.enabled}
                onChangeComplete={(nextVolume) => {
                  if (input) {
                    onChange(input.name, input.enabled, nextVolume, input.sourceId);
                  }
                }}
              />
              <span className="text-sm">{detected ? `${volume}%` : "--"}</span>
              <Tooltip title={detected ? "设备、音量和增益均读取自 OBS。" : "检测到 OBS 后自动读取状态。"}>
                <div className="flex items-center gap-2">
                  <div className="flex h-2 flex-1 gap-px overflow-hidden bg-gray-100">
                    {Array.from({ length: 10 }).map((_, index) => (
                      <span
                        className={detected && index < Math.round(volume / 10) ? "flex-1 bg-emerald-400" : "flex-1 bg-gray-200"}
                        key={index}
                      />
                    ))}
                  </div>
                  <span className="w-10 text-right text-xs text-[var(--app-text-secondary)]">
                    {detected && input ? `${Math.round(input.volumeDb)} dB` : "--"}
                  </span>
                </div>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </ObsSection>
  );
}
