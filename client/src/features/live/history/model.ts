export interface HistorySegment {
  file: string;
  programDateTime: string;
  programDateTimeOffsetSeconds?: number;
  durationSeconds: number;
  discontinuity: boolean;
}

export interface HistoryBattle {
  pullId: string;
  encounterName: string;
  startedAtUnixMs: number;
  endedAtUnixMs: number | null;
  eventCount: number;
  eventRevision: string;
  playerName: string | null;
  indexComplete: boolean;
}

export interface LiveHistoryManifest {
  sessionId: string;
  sessionStartedAtUnixMs: number;
  playlistUrl: string;
  segments: HistorySegment[];
  activeBattle: HistoryBattle | null;
  recentBattles?: HistoryBattle[];
  timingBasis: "serverReceptionClock";
}

export interface HistoryRange { startMs: number; endMs: number }
export interface HistorySeekRequest { id: number; sessionId: string; unixMs: number }

export interface LiveMediaIntent {
  volume: number;
  muted: boolean;
  playbackRate: number;
  playing: boolean;
}
