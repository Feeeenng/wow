export type LocalRecordingState =
  | "recording"
  | "waitingForTail"
  | "waitingForSource"
  | "waitingForPlayback"
  | "processing"
  | "ready"
  | "partial"
  | "failed"
  | "interrupted";

export interface LocalClipMapping {
  actualStartUnixMs: number;
  actualEndUnixMs: number;
  videoZeroMs: number;
  hasGap: boolean;
}

export type LocalTimelineOwner = "boss" | "player";
export type LocalTimelineEventKind = "castStart" | "castSuccess";

export interface LocalTimelineEvent {
  pullTimeMs: number;
  owner: LocalTimelineOwner;
  kind: LocalTimelineEventKind;
  sourceName: string;
  spellId: number;
  spellName: string;
}

/** Rust 本地录制索引提供给回放页面的单场 Boss 录像。 */
export interface LocalRecording {
  pullId: string;
  encounterId: number;
  encounterName: string;
  difficultyId: number;
  groupSize: number;
  success: boolean | null;
  encounterStartUnixMs: number;
  encounterEndUnixMs: number | null;
  clipStartUnixMs: number;
  clipEndUnixMs: number | null;
  state: LocalRecordingState;
  playerName: string | null;
  timelineEvents: LocalTimelineEvent[];
  mapping: LocalClipMapping | null;
  videoPath: string | null;
  playbackPath: string | null;
  playbackUrl: string | null;
  error: string | null;
}
