import { invoke } from "@tauri-apps/api/core";
import type { SharedCalibration } from "@/shared/replay/model";

export const readSharedCalibration = (pullId: string) => invoke<SharedCalibration>("get_cloud_replay_calibration", { pullId });
export const saveSharedCalibration = (pullId: string, expectedVersion: number, playbackVersion: string, offsetMs: number) =>
  invoke<SharedCalibration>("save_cloud_replay_calibration", { pullId, request: { expectedVersion, playbackVersion, offsetMs } });
