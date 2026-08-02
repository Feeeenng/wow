import { invoke } from "@tauri-apps/api/core";
import type { PersonalLiveSession, WhepAnswer } from "@/features/live/model";

const isTauri = () => "__TAURI_INTERNALS__" in window;

/** 隔离直播会话和 WHEP 信令，React 不接触发布地址或凭证。 */
export const liveService = {
  async currentPersonalSession(): Promise<PersonalLiveSession | null> {
    if (!isTauri()) {
      return null;
    }
    return invoke("get_live_session");
  },
  async negotiatePlayback(sessionId: string, offerSdp: string): Promise<WhepAnswer> {
    if (!isTauri()) {
      throw new Error("直播播放仅可在桌面客户端中使用");
    }
    return invoke("negotiate_live_playback", { sessionId, offerSdp });
  },
  async releasePlayback(playbackId: string): Promise<void> {
    if (isTauri()) {
      await invoke("release_live_playback", { playbackId });
    }
  },
};
