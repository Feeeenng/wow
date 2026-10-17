import type { LocalRecording, LocalClipMapping, SharedCalibration } from "@/shared/replay/model";
import { UUID_PATTERN } from "@/config";

export const uuid = (value: unknown): value is string => typeof value === "string" && UUID_PATTERN.test(value);
export interface CloudEntry {
  teamId: string; teamPullId: string; recordingId: string;
  encounterId: number; encounterName: string; difficultyId: number;
  encounterStartUnixMs: number; encounterEndUnixMs: number;
  characterGuid: string; characterName: string; status: string;
  videoZeroMs: number; videoDurationMs: number; intervals: LocalClipMapping["intervals"];
  players: LocalRecording["players"]; playbackVersion: string | null;
  hasGap?: boolean; clockDiscontinuous?: boolean; mediaCalibrated?: boolean; calibrationError?: string | null;
  processingError?: string | null; success?: boolean | null; groupSize?: number;
  timelineRevision?: string; timelineEventCount?: number; timelineComplete?: boolean;
  wclStatus?: LocalRecording["wclStatus"]; sharedCalibration?: SharedCalibration;
}

/** 使用服务端共同零点，网页不再次按人物日志起点平移。 */
export function normalizeEntry(raw: CloudEntry, team: string): LocalRecording {
  if (!uuid(raw.recordingId) || !uuid(raw.teamPullId) || raw.teamId !== team || !uuid(team)
    || !Number.isSafeInteger(raw.encounterStartUnixMs) || !Number.isSafeInteger(raw.encounterEndUnixMs)
    || raw.encounterEndUnixMs <= raw.encounterStartUnixMs || !Number.isSafeInteger(raw.videoZeroMs)
    || !Number.isSafeInteger(raw.videoDurationMs) || raw.videoDurationMs <= 0 || !Array.isArray(raw.players)
    || typeof raw.characterName !== "string" || typeof raw.characterGuid !== "string" || typeof raw.encounterName !== "string"
    || raw.players.some((player) => !player || typeof player.guid !== "string" || typeof player.name !== "string")) throw new Error("团队录像目录格式无效。");
  const states: Record<string, LocalRecording["state"]> = { ready: "ready", failed: "failed", pendingUpload: "waitingForSource", uploaded: "waitingForPlayback", processing: "processing" };
  const state = Object.hasOwn(states, raw.status) ? states[raw.status] : null;
  if (!state || state === "ready" && !uuid(raw.playbackVersion)) throw new Error("团队录像发布状态无效。");
  return {
    sourceKind: "cloud", cloudStatus: raw.status as LocalRecording["cloudStatus"], cloudTeamPullId: raw.teamPullId,
    cloudPlaybackVersion: raw.playbackVersion, sharedCalibration: raw.sharedCalibration, wclStatus: raw.wclStatus,
    pullId: raw.recordingId, battleKey: team + ":" + raw.teamPullId, encounterId: raw.encounterId, encounterName: raw.encounterName,
    difficultyId: raw.difficultyId, groupSize: raw.groupSize ?? raw.players.length, success: raw.success ?? null,
    encounterStartUnixMs: raw.encounterStartUnixMs, encounterEndUnixMs: raw.encounterEndUnixMs,
    clipStartUnixMs: raw.encounterStartUnixMs - raw.videoZeroMs,
    clipEndUnixMs: raw.encounterStartUnixMs - raw.videoZeroMs + raw.videoDurationMs,
    state, playerName: raw.characterName, recordingPlayerGuid: raw.characterGuid,
    players: raw.players, timelineEvents: [], timelineParseErrors: 0, timelineRevision: raw.timelineRevision,
    timelineEventCount: raw.timelineEventCount, timelineComplete: raw.timelineComplete,
    mapping: { videoZeroMs: raw.videoZeroMs, mediaDurationMs: raw.videoDurationMs, actualStartUnixMs: raw.encounterStartUnixMs - raw.videoZeroMs,
      actualEndUnixMs: raw.encounterStartUnixMs - raw.videoZeroMs + raw.videoDurationMs, intervals: raw.intervals ?? [],
      hasGap: raw.hasGap ?? false, clockDiscontinuous: raw.clockDiscontinuous ?? false, mediaCalibrated: raw.mediaCalibrated ?? false, calibrationError: raw.calibrationError ?? null },
    videoPath: null, playbackPath: null, playbackUrl: null, error: raw.processingError ?? null,
  };
}

const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const clock = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const businessDate = (ms: number) => date.format(ms);
export const businessClock = (ms: number) => clock.format(ms);
export const durationLabel = (seconds: number) => Math.floor(Math.max(0, seconds) / 60) + ":" + Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, "0");
const difficulties: Record<number, string> = { 14: "普通", 15: "英雄", 16: "史诗", 17: "随机团队" };
export const difficultyLabel = (id: number) => difficulties[id] ?? "难度 " + id;
