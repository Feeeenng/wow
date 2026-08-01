import { AudioOutlined, SoundOutlined } from "@ant-design/icons";
import { Select, Slider, Tooltip } from "antd";
import { useEffect, useState } from "react";
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
  { kind: "desktop", label: "扬声器", icon: SoundOutlined },
  { kind: "microphone", label: "麦克风", icon: AudioOutlined },
];

function meterSegmentCount(meterDb: number | null | undefined): number {
  if (meterDb == null) {
    return 0;
  }
  return Math.round(((Math.max(-60, Math.min(0, meterDb)) + 60) / 60) * 10);
}

/** 设备、推子和电平均展示 OBS 当前状态，未连接时保留灰色默认结构。 */
export function ObsAudioSettingsPanel({ connected, inputs, onChange }: ObsAudioSettingsPanelProps) {
  const [draftVolumes, setDraftVolumes] = useState<Record<string, number>>({});

  useEffect(() => {
    setDraftVolumes(Object.fromEntries(inputs.map((input) => [input.name, input.volumePercent])));
  }, [inputs]);

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
          const volume = input ? (draftVolumes[input.name] ?? input.volumePercent) : 0;
          const activeSegments = meterSegmentCount(input?.meterDb);
          return (
            <div
              className={`grid grid-cols-[28px_minmax(130px,1fr)_minmax(90px,0.7fr)_40px_100px] items-center gap-3 ${detected ? "" : "text-gray-400"}`}
              key={channel.kind}
            >
              <Tooltip title={channel.label}>
                <span className="inline-flex justify-center">
                  <Icon className={detected ? "text-[var(--app-primary)]" : "text-gray-400"} />
                </span>
              </Tooltip>
              <Select
                value={input?.sourceId || undefined}
                placeholder="默认"
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
                disabled={!detected}
                onChange={(nextVolume) => {
                  if (input) {
                    setDraftVolumes((current) => ({
                      ...current,
                      [input.name]: nextVolume,
                    }));
                  }
                }}
                onChangeComplete={(nextVolume) => {
                  if (input) {
                    onChange(input.name, input.enabled, nextVolume, input.sourceId);
                  }
                }}
              />
              <span className="text-sm">{detected ? `${volume}%` : "--"}</span>
              <Tooltip title="实时电平由 OBS WebSocket 音量表事件提供。">
                <div className="flex items-center gap-2">
                  <div className="flex h-2 flex-1 gap-px overflow-hidden bg-gray-100">
                    {Array.from({ length: 10 }).map((_, index) => (
                      <span
                        className={index < activeSegments ? "flex-1 bg-emerald-400" : "flex-1 bg-gray-200"}
                        key={index}
                      />
                    ))}
                  </div>
                  <span className="w-12 text-right text-xs text-[var(--app-text-secondary)]">
                    {input?.meterDb == null ? "--" : `${Math.round(input.meterDb)} dB`}
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
