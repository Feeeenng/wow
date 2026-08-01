import { invoke } from "@tauri-apps/api/core";
import type { ObsConnectRequest, ObsStatus } from "@/features/obs/model";
import { disconnectedObsStatus } from "@/features/obs/model";

const isTauri = () => "__TAURI_INTERNALS__" in window;

/** 统一封装 React 到 Rust 的 OBS WebSocket 命令。 */
export const obsService = {
  async status(): Promise<ObsStatus> {
    return isTauri() ? invoke("get_obs_status") : disconnectedObsStatus;
  },
  async connect(request: ObsConnectRequest): Promise<ObsStatus> {
    if (!isTauri()) throw new Error("浏览器预览无法连接 OBS WebSocket");
    return invoke("connect_obs", { request });
  },
  async disconnect(): Promise<ObsStatus> {
    return isTauri() ? invoke("disconnect_obs") : disconnectedObsStatus;
  },
  async startRecording(): Promise<ObsStatus> {
    if (!isTauri()) throw new Error("浏览器预览无法控制 OBS 录制");
    return invoke("start_obs_recording");
  },
  async stopRecording(): Promise<ObsStatus> {
    if (!isTauri()) throw new Error("浏览器预览无法控制 OBS 录制");
    return invoke("stop_obs_recording");
  },
  async openControlWindow(): Promise<void> {
    if (isTauri()) {
      await invoke("open_obs_control_window");
      return;
    }
    window.open("/?window=obs", "obs-control", "width=760,height=640");
  },
};
