import { invoke } from "@tauri-apps/api/core";
import type { LocalRecording } from "@/features/recording/model";

const isTauri = () => "__TAURI_INTERNALS__" in window;
const LOCAL_REPLAY_ORIGIN = "http://local-replay.localhost";

type LocalRecordingResponse = Omit<LocalRecording, "playbackUrl">;

function withPlaybackUrl(recording: LocalRecordingResponse): LocalRecording {
  return {
    ...recording,
    playbackUrl: recording.playbackPath
      ? `${LOCAL_REPLAY_ORIGIN}/${encodeURIComponent(recording.pullId)}/index.m3u8`
      : null,
  };
}

/** 隔离本地录像命令和 Tauri 自定义播放协议。 */
export const recordingService = {
  async list(): Promise<LocalRecording[]> {
    if (!isTauri()) {
      return [];
    }
    const recordings = await invoke<LocalRecordingResponse[]>("list_local_recordings");
    return recordings
      .map(withPlaybackUrl)
      .sort((left, right) => right.encounterStartUnixMs - left.encounterStartUnixMs);
  },
};
