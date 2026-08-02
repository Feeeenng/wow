import { invoke } from "@tauri-apps/api/core";
import type { PersonalLiveSession } from "@/features/live/model";

const isTauri = () => "__TAURI_INTERNALS__" in window;

/** 隔离 OBS 虚拟摄像头控制，React 只负责挂载返回的视频设备。 */
export const liveService = {
  async startPersonalSession(): Promise<PersonalLiveSession> {
    if (!isTauri()) {
      throw new Error("个人直播仅可在桌面客户端中启动");
    }
    return invoke("start_virtual_camera_preview");
  },
};
