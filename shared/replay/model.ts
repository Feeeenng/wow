/** 桌面与Web共用的回放数据契约，不依赖Tauri或浏览器状态。 */
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
  intervals: LocalClipInterval[];
  mediaDurationMs: number | null;
  mediaCalibrated: boolean;
  calibrationError: string | null;
  clockDiscontinuous: boolean;
}

export interface LocalClipInterval {
  pullStartMs: number;
  pullEndMs: number;
  videoStartMs: number;
  videoEndMs: number;
}

export type LocalTimelineOwner = "boss" | "player" | "team";
export type LocalTimelineEventKind = "castStart" | "castSuccess" | "death"
  | "empowerStart" | "empowerEnd" | "empowerInterrupt" | "resurrect"
  | "buffApply" | "buffRemove" | "buffStack" | "debuffApply" | "debuffRemove" | "debuffStack"
  | "buffRefresh" | "debuffRefresh" | "interrupt" | "dispel";

export interface LocalTimelineEvent {
  eventId: string;
  pullTimeMs: number;
  owner: LocalTimelineOwner;
  kind: LocalTimelineEventKind;
  sourceName: string;
  sourceGuid: string;
  targetGuid: string;
  targetName: string;
  extraSpellId: number | null;
  stackCount: number | null;
  /** 只有来源明确给出等级时显示；旧快照和普通施法不推测。 */
  empowerLevel?: number | null;
  spellId: number;
  spellName: string;
  /** WCL 报告内人物身份独立于 CombatLog GUID，不用名字猜测对应关系。 */
  identityNamespace?: string;
  sourceActorId?: number | null;
  targetActorId?: number | null;
  sourceIsPlayer?: boolean;
  targetIsPlayer?: boolean;
  rawType?: string;
}

/** 团队共享偏移按媒体发布版本生效，旧值可供人工复核。 */
export interface SharedCalibration {
  version: number;
  playbackVersion: string | null;
  savedPlaybackVersion: string | null;
  offsetMs: number;
  active: boolean;
  stale: boolean;
  canEdit: boolean;
  updatedAt: string | null;
  minOffsetMs: number;
  maxOffsetMs: number;
}

/** 本地和团队共用的单视角播放契约，平台身份与游戏GUID保持独立。 */
export interface LocalRecording {
  sourceKind?: "local" | "cloud";
  cloudStatus?: "pendingUpload" | "uploaded" | "processing" | "ready" | "failed";
  canRetryProcessing?: boolean;
  cloudTeamPullId?: string;
  cloudPlaybackVersion?: string | null;
  sharedCalibration?: SharedCalibration | null;
  wclStatus?: "unbound" | "pending" | "importing" | "ready" | "failed";
  importedSource?: string | null;
  recordingPlayerGuid?: string | null;
  battleKey?: string | null;
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
  timelineEventCount?: number;
  timelineRevision?: string;
  timelineComplete?: boolean;
  timelineParseErrors: number;
  players: { guid: string; name: string; fullType?: string | null; serverName?: string | null; actorId?: number | null }[];
  mapping: LocalClipMapping | null;
  videoPath: string | null;
  playbackPath: string | null;
  playbackUrl: string | null;
  error: string | null;
}
