import { invoke } from "@tauri-apps/api/core";
import { recordingService } from "@/features/recording/recordingService";
import type { LocalRecording } from "@/shared/replay/model";

export interface ManagedRecordingSummary {
  pullId: string;
  bytes: number;
  isFavorited: boolean;
  canDelete: boolean;
  canOpenDirectory: boolean;
  blockedReason: string | null;
}

export type ManagedRecording = LocalRecording & ManagedRecordingSummary;

/** 只向后端传稳定录像身份，文件路径与可删除范围全部由 Rust 核验。 */
export const recordingManagement = {
  async list(): Promise<ManagedRecording[]> {
    // 目录接口可迁移旧产物，因此必须先完成刷新，再读取管理权限与空间摘要。
    const recordings = await recordingService.list();
    if (!("__TAURI_INTERNALS__" in window)) return [];
    const summaries = await invoke<ManagedRecordingSummary[]>("list_managed_recordings");
    const byId = new Map(summaries.map((summary) => [summary.pullId, summary]));
    return recordings.map((recording) => ({
      ...recording,
      ...(byId.get(recording.pullId) ?? {
        pullId: recording.pullId, bytes: 0, isFavorited: false, canDelete: false,
        canOpenDirectory: false, blockedReason: "录像状态已变化，请刷新后重试",
      }),
    }));
  },
  async favorite(pullId: string, isFavorited: boolean): Promise<void> {
    await invoke("set_recording_favorite", { pullId, isFavorited });
  },
  async openDirectory(pullId: string): Promise<void> {
    await invoke("open_recording_directory", { pullId });
  },
  async delete(pullId: string): Promise<void> {
    await invoke("delete_recording", { pullId });
  },
};
