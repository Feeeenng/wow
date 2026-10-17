import { invoke } from "@tauri-apps/api/core";
import type { LocalRecording } from "@/shared/replay/model";
import { CLOUD_REPLAY_PAGE_SIZE } from "@/features/replay/config";

type CloudRecordingResponse = Omit<LocalRecording, "timelineRevision"> & { timelineRevision?: string | null };

/** 团队目录和显式上传目标共用受限原生命令，保留私有媒体地址并归一化空事件。 */
export async function readCloudReplayPage(offset: number): Promise<LocalRecording[]> {
  const response = await invoke<CloudRecordingResponse[]>("list_cloud_replays", { offset, limit: CLOUD_REPLAY_PAGE_SIZE });
  return response.map((recording) => ({ ...recording, timelineRevision: recording.timelineRevision ?? undefined, timelineEvents: recording.timelineEvents ?? [] }));
}
