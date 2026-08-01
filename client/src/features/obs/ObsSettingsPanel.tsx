import { Alert } from "antd";
import { ObsAudioSettingsPanel } from "@/features/obs/ObsAudioSettingsPanel";
import { ObsRuntimePanel } from "@/features/obs/ObsRuntimePanel";
import { ObsVideoSettingsPanel } from "@/features/obs/ObsVideoSettingsPanel";
import { useObsSettings } from "@/features/obs/useObsSettings";

/** 组合设置中心内与参考图一致的 OBS 设置区域。 */
export function ObsSettingsPanel() {
  const obs = useObsSettings();

  return (
    <div className="space-y-4">
      {obs.error && <Alert type="error" showIcon message="OBS 操作失败" description={obs.error} closable />}
      <div className="grid grid-cols-2 items-start gap-4 max-[1100px]:grid-cols-1">
        <ObsRuntimePanel
          status={obs.status}
          installation={obs.installation}
          busyAction={obs.busyAction}
          onInstall={() => void obs.install()}
          onRefresh={() => void obs.refresh()}
          onOpenRecordDirectory={() => void obs.openRecordDirectory()}
          onToggleRecording={() => void obs.toggleRecording()}
        />
        <div className="space-y-4">
          <ObsVideoSettingsPanel
            connected={obs.status.connected}
            video={obs.video}
            capture={obs.capture}
            onVideoChange={(video) => void obs.setVideo(video)}
            onCaptureChange={(capture) => void obs.setCapture(capture)}
          />
          <ObsAudioSettingsPanel
            connected={obs.status.connected}
            inputs={obs.audioInputs}
            onChange={(...args) => void obs.setAudio(...args)}
          />
        </div>
      </div>
    </div>
  );
}
