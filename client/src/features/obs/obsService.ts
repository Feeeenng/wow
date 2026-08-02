import { invoke } from "@tauri-apps/api/core";
import type {
  ObsAudioInput,
  ObsAudioSettings,
  ObsCaptureSettings,
  ObsInstallationStatus,
  ObsSettingsSnapshot,
  ObsStatus,
  ObsVideoSettings,
} from "@/features/obs/model";
import {
  defaultCaptureSettings,
  defaultInstallationStatus,
  defaultVideoSettings,
  disconnectedObsStatus,
} from "@/features/obs/model";

const isTauri = () => "__TAURI_INTERNALS__" in window;

const requireDesktop = () => {
  if (!isTauri()) {
    throw new Error("该操作只能在 Tauri 桌面客户端中执行");
  }
};

/** 统一封装 React 到 Rust 的 OBS 安装、配置、录制与直播命令。 */
export const obsService = {
  async status(): Promise<ObsStatus> {
    return isTauri() ? invoke("get_obs_status") : disconnectedObsStatus;
  },
  async installation(): Promise<ObsInstallationStatus> {
    return isTauri() ? invoke("get_obs_installation") : defaultInstallationStatus;
  },
  async install(): Promise<ObsInstallationStatus> {
    requireDesktop();
    return invoke("install_portable_obs", { installDir: null });
  },
  async openInstallDirectory(): Promise<void> {
    requireDesktop();
    await invoke("open_obs_install_directory");
  },
  async videoSettings(): Promise<ObsVideoSettings> {
    return isTauri() ? invoke("get_obs_video_settings") : defaultVideoSettings;
  },
  async captureSettings(): Promise<ObsCaptureSettings> {
    return isTauri() ? invoke("get_obs_capture_settings") : defaultCaptureSettings;
  },
  async audioInputs(): Promise<ObsAudioInput[]> {
    return isTauri() ? invoke("get_obs_audio_inputs") : [];
  },
  async cachedSettings(): Promise<ObsSettingsSnapshot | null> {
    return isTauri() ? invoke("get_cached_obs_settings") : null;
  },
  async settingsSnapshot(): Promise<ObsSettingsSnapshot> {
    requireDesktop();
    return invoke("get_obs_settings_snapshot");
  },
  async openRecordDirectory(): Promise<void> {
    requireDesktop();
    await invoke("open_obs_record_directory");
  },
  async setVideoSettings(settings: ObsVideoSettings): Promise<void> {
    requireDesktop();
    await invoke("set_obs_video_settings", { settings });
  },
  async configureGameCapture(settings: ObsCaptureSettings): Promise<void> {
    requireDesktop();
    await invoke("configure_obs_game_capture", { settings });
  },
  async setAudioSettings(settings: ObsAudioSettings): Promise<void> {
    requireDesktop();
    await invoke("set_obs_audio_settings", { settings });
  },
  async startRecording(): Promise<ObsStatus> {
    requireDesktop();
    return invoke("start_obs_recording");
  },
  async stopRecording(): Promise<ObsStatus> {
    requireDesktop();
    return invoke("stop_obs_recording");
  },
  async startLive(): Promise<void> {
    requireDesktop();
    await invoke("start_live_session");
  },
  async stopLive(): Promise<void> {
    requireDesktop();
    await invoke("stop_live_session");
  },
};
