import { invoke } from "@tauri-apps/api/core";
import { REPLAY_ICON_PERCENT, REPLAY_TIMELINE_ZOOM, REPLAY_TRACK_HEIGHT } from "@/shared/replay/config";
import type { TimelineLayout } from "@/shared/replay/tracks";

export interface ReplayPreferences extends TimelineLayout {
  selectedPullId: string | null;
  bookmarksMs: Record<string, number>;
  offsetsMs: Record<string, number>;
  offsetVersions?: Record<string, string>;
  volume: number;
  muted: boolean;
  playbackRate: number;
  eventKinds: string[];
  actorGuid: string | null;
  catalogSource: "local" | "team";
}

export const defaultReplayPreferences: ReplayPreferences = {
  selectedPullId: null,
  bookmarksMs: {},
  offsetsMs: {},
  offsetVersions: {},
  volume: 1,
  muted: false,
  playbackRate: 1,
  eventKinds: [],
  actorGuid: null,
  timelineTrackHeight: REPLAY_TRACK_HEIGHT,
  timelineIconPercent: REPLAY_ICON_PERCENT,
  timelineZoom: REPLAY_TIMELINE_ZOOM,
  timelineTrackOverrides: {},
  catalogSource: "local",
  customTimelineTracks: [],
};

/** 隔离 Rust 偏好存储，浏览器演示只保留当前进程状态。 */
export const replayPreferencesService = {
  async load(): Promise<ReplayPreferences> {
    if (!("__TAURI_INTERNALS__" in window)) return defaultReplayPreferences;
    return invoke<ReplayPreferences>("get_replay_preferences");
  },
  async save(preferences: ReplayPreferences): Promise<void> {
    if ("__TAURI_INTERNALS__" in window) {
      await invoke("set_replay_preferences", { preferences });
    }
  },
};
