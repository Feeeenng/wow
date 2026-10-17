import type { LocalRecording } from "@/shared/replay/model";

interface OffsetPreferences {
  offsetsMs: Record<string, number>;
  offsetVersions?: Record<string, string>;
}

/** 旧发布版本的共享值只供复核，不能误用到新产物或本地录像。 */
export function sharedOffset(recording: LocalRecording): number {
  const snapshot = recording.sharedCalibration;
  return recording.sourceKind === "cloud" && !!recording.cloudPlaybackVersion && snapshot?.active && !snapshot.stale
    && snapshot.playbackVersion === recording.cloudPlaybackVersion && snapshot.savedPlaybackVersion === recording.cloudPlaybackVersion
    && Number.isSafeInteger(snapshot.offsetMs) ? snapshot.offsetMs : 0;
}

/** 正偏移定位到更晚视频；团队值与本机微调只相加一次，双向映射及切视角共用。 */
export function personalOffsetStale(recording: LocalRecording, preferences: OffsetPreferences): boolean {
  return recording.sourceKind === "cloud" && (preferences.offsetsMs[recording.pullId] ?? 0) !== 0
    && (!recording.cloudPlaybackVersion || preferences.offsetVersions?.[recording.pullId] !== recording.cloudPlaybackVersion);
}

/** 本地旧偏好保持兼容；团队录像的本机值需绑定同一发布版本才应用。 */
export function personalOffset(recording: LocalRecording, preferences: OffsetPreferences): number {
  return personalOffsetStale(recording, preferences) ? 0 : preferences.offsetsMs[recording.pullId] ?? 0;
}

/** 统一计算实际生效值，不覆盖用户原来的待复核偏移。 */
export function effectiveOffset(recording: LocalRecording, preferences: OffsetPreferences): number {
  return sharedOffset(recording) + personalOffset(recording, preferences);
}
