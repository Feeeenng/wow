import { invoke } from "@tauri-apps/api/core";
import type { CloudIdentity, CloudSettings, CloudSettingsInput, CloudUploadJob } from "@/features/cloud/model";

const isTauri = () => "__TAURI_INTERNALS__" in window;

function requireNative<T>(command: string, args?: Record<string, unknown>) {
  return isTauri() ? invoke<T>(command, args) : Promise.reject(new Error("云端配置与上传需要在桌面客户端中操作"));
}

export function getCloudSettings() {
  return isTauri() ? invoke<CloudSettings>("get_cloud_settings") : Promise.resolve<CloudSettings>({ connectionKey: "", endpoint: "", teamId: null, deviceId: "", hasToken: false, identity: null });
}

export function setCloudSettings(settings: CloudSettingsInput) {
  return requireNative<void>("set_cloud_settings", { settings });
}

export function verifyCloudConnection() {
  return requireNative<CloudIdentity>("verify_cloud_connection");
}

export function getCloudUploads() {
  return isTauri() ? invoke<CloudUploadJob[]>("get_cloud_uploads") : Promise.resolve<CloudUploadJob[]>([]);
}

export function enqueueCloudUpload(pullId: string, teamPullId?: string) {
  return requireNative<string>("enqueue_cloud_upload", { pullId, teamPullId });
}

export function changeCloudUpload(action: "retry" | "pause" | "cancel", jobId: string) {
  return requireNative<void>(`${action}_cloud_upload`, { jobId });
}
