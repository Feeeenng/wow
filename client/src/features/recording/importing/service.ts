import { invoke } from "@tauri-apps/api/core";
import type { RecordingImportPreferences, RecordingImportProgress } from "@/features/recording/importing/model";
import { emptyImportPreferences, emptyImportProgress } from "@/features/recording/importing/model";

/** 导入偏好仅由 Rust 统一存储；任务进度每次从原生进程重新读取。 */
export const recordingImportService = {
  async preferences(): Promise<RecordingImportPreferences> {
    return "__TAURI_INTERNALS__" in window ? invoke("get_recording_import_preferences") : emptyImportPreferences;
  },
  async progress(): Promise<RecordingImportProgress> {
    return "__TAURI_INTERNALS__" in window ? invoke("get_recording_import") : emptyImportProgress;
  },
  async start(preferences: RecordingImportPreferences): Promise<RecordingImportProgress> {
    await invoke("set_recording_import_preferences", { preferences });
    return invoke("start_recording_import", { request: preferences });
  },
  async cancel(taskId: string): Promise<void> {
    await invoke("cancel_recording_import", { taskId });
  },
};
