import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording, LocalTimelineEventKind } from "@/shared/replay/model";
import { REPLAY_CHECKPOINT_MS, REPLAY_END_MARGIN_SECONDS, REPLAY_EVENT_LEAD_SECONDS, REPLAY_DEATH_LEAD_SECONDS } from "@/features/replay/config";
import { pullToVideo, replayIntervals, videoToPull } from "@/shared/replay/mapping";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { sameBattle } from "@/features/replay/perspective";
import { effectiveOffset, personalOffset, personalOffsetStale } from "@/shared/replay/calibration";

export interface ReplaySeekRequest {
  id: number;
  seconds: number;
  play?: boolean;
}

/** 将唯一战斗时间转换为当前媒体位置，屏蔽旧源及待跳转期间的迟到进度。 */
export function useReplayPlayback(recording: LocalRecording | null) {
  const { preferences, update } = useReplayState();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [pullTime, setPullTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState<ReplaySeekRequest | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [positionMessage, setPositionMessage] = useState<string | null>(null);
  const [reloadId, setReloadId] = useState(0);
  const operation = useRef(0);
  const pending = useRef<number | null>(null);
  const checkpointAt = useRef(0);
  const pendingSelection = useRef<{ pullId: string; seconds: number; play: boolean } | null>(null);
  const lastCalibration = useRef<{ pullId: string | null; offsetMs: number } | null>(null);
  const current = useRef({ recording, preferences });
  current.current = { recording, preferences };
  const duration = recording?.encounterEndUnixMs == null ? 0
    : Math.max(0, recording.encounterEndUnixMs - recording.encounterStartUnixMs) / 1_000;
  const storedPersonalOffsetMs = recording ? preferences.offsetsMs[recording.pullId] ?? 0 : 0;
  const personalOffsetMs = recording ? personalOffset(recording, preferences) : 0;
  const personalOffsetNeedsReview = recording ? personalOffsetStale(recording, preferences) : false;
  const offsetMs = recording ? effectiveOffset(recording, preferences) : 0;

  const checkpoint = useCallback((seconds: number, force = false) => {
    const selected = current.current.recording;
    if (!selected) return;
    const now = performance.now();
    if (!force && now - checkpointAt.current < REPLAY_CHECKPOINT_MS) return;
    checkpointAt.current = now;
    const timeMs = Math.round(Math.max(0, seconds) * 1_000);
    update((value) => value.bookmarksMs[selected.pullId] === timeMs ? value : {
      ...value, bookmarksMs: { ...value.bookmarksMs, [selected.pullId]: timeMs },
    });
  }, [update]);

  const seekToPull = useCallback((seconds: number, play?: boolean) => {
    const { recording: selected, preferences: saved } = current.current;
    if (!selected?.playbackUrl || !Number.isFinite(seconds)) return;
    const end = selected.encounterEndUnixMs == null ? 0
      : (selected.encounterEndUnixMs - selected.encounterStartUnixMs) / 1_000;
    const target = Math.min(Math.max(0, seconds), Math.max(0, end - REPLAY_END_MARGIN_SECONDS));
    const mapped = pullToVideo(selected, target, effectiveOffset(selected, saved));
    if (mapped.kind !== "mapped") {
      setPositionMessage(mapped.kind === "gap" ? "该战斗时段没有录像，请选择其他时间。" : "该录像缺少可用的时间映射，暂不能按战斗时间跳转。");
      return;
    }
    const id = ++operation.current;
    pending.current = id;
    setPositionMessage(null);
    setPullTime(target);
    setSeekRequest({ id, seconds: mapped.seconds, play });
  }, []);

  useEffect(() => {
    pending.current = null;
    setSeekRequest(null);
    setPlaybackError(null);
    setPositionMessage(null);
    const selected = current.current.recording;
    if (!selected) return;
    const switchIntent = pendingSelection.current?.pullId === selected.pullId ? pendingSelection.current : null;
    pendingSelection.current = null;
    const bookmark = switchIntent?.seconds ?? (current.current.preferences.bookmarksMs[selected.pullId] ?? 0) / 1_000;
    setPullTime(bookmark);
    const intervals = replayIntervals(selected);
    const mapped = pullToVideo(selected, bookmark, effectiveOffset(selected, current.current.preferences));
    if (mapped.kind === "mapped") {
      seekToPull(bookmark, switchIntent?.play);
    } else if (intervals.length > 0) {
      // 恢复书签不存在或处于缺口时，从真实有画面的首段恢复。
      seekToPull(Math.max(0, intervals[0].pullStartMs / 1_000));
    }
    return () => { pending.current = null; };
  }, [recording?.pullId, recording?.state, recording?.playbackUrl, recording?.mapping?.mediaCalibrated, reloadId, seekToPull]);

  /** 先验证新视角覆盖当前战斗位置，失败时保留旧视角，禁止跳到无关画面。 */
  const prepareSelection = (next: LocalRecording, targetTime = pullTime) => {
    const selected = current.current.recording;
    if (!selected || selected.pullId === next.pullId || !sameBattle(selected, next)) return true;
    const mapped = pullToVideo(next, targetTime, effectiveOffset(next, current.current.preferences));
    if (!next.playbackUrl || !["ready", "partial"].includes(next.state) || mapped.kind !== "mapped") {
      setPositionMessage("该人物的录像尚不可播放或不覆盖当前战斗时间，已保留当前视角。");
      return false;
    }
    checkpoint(targetTime, true);
    pendingSelection.current = { pullId: next.pullId, seconds: targetTime, play: videoRef.current ? !videoRef.current.paused : false };
    return true;
  };

  const onCurrentTimeChange = useCallback((seconds: number) => {
    const { recording: selected, preferences: saved } = current.current;
    if (!selected || pending.current !== null) return;
    const mapped = videoToPull(selected, seconds, effectiveOffset(selected, saved));
    if (mapped.kind !== "mapped") return;
    const end = selected.encounterEndUnixMs == null ? 0
      : (selected.encounterEndUnixMs - selected.encounterStartUnixMs) / 1_000;
    const time = Math.min(end, Math.max(0, mapped.seconds));
    setPullTime(time);
    checkpoint(time);
  }, [checkpoint]);

  const onSeekComplete = useCallback((id: number, seconds: number) => {
    if (pending.current !== id) return;
    pending.current = null;
    setSeekRequest(null);
    onCurrentTimeChange(seconds);
    const selected = current.current.recording;
    if (selected) {
      const mapped = videoToPull(selected, seconds, effectiveOffset(selected, current.current.preferences));
      if (mapped.kind === "mapped") checkpoint(mapped.seconds, true);
    }
  }, [checkpoint, onCurrentTimeChange]);

  const onPlaybackError = useCallback((message: string | null) => {
    setPlaybackError(message);
    if (message) {
      pending.current = null;
      setSeekRequest(null);
    }
  }, []);

  const onMediaPreferencesChange = useCallback((video: HTMLVideoElement) => {
    const { volume, muted, playbackRate } = video;
    update((value) => value.volume === volume && value.muted === muted && value.playbackRate === playbackRate
      ? value : { ...value, volume, muted, playbackRate });
  }, [update]);

  const setOffset = useCallback((milliseconds: number) => {
    const selected = current.current.recording;
    if (!selected || !Number.isSafeInteger(milliseconds)) return;
    update((value) => ({ ...value, offsetsMs: { ...value.offsetsMs, [selected.pullId]: milliseconds },
      offsetVersions: selected.sourceKind === "cloud" && selected.cloudPlaybackVersion
        ? { ...value.offsetVersions, [selected.pullId]: selected.cloudPlaybackVersion } : value.offsetVersions }));
  }, [update]);

  useEffect(() => {
    const previous = lastCalibration.current;
    const pullId = recording?.pullId ?? null;
    lastCalibration.current = { pullId, offsetMs };
    if (recording && previous?.pullId === pullId && previous.offsetMs !== offsetMs) seekToPull(pullTime);
    // 用户校准变更时保留当前战斗位置；媒体进度不触发反复 seek。
  }, [offsetMs, recording?.pullId]);

  const seekToEvent = useCallback((seconds: number, kind?: LocalTimelineEventKind) => {
    const { recording: selected, preferences: saved } = current.current;
    if (!selected) return;
    const target = Math.max(0, seconds - (kind === "death" ? REPLAY_DEATH_LEAD_SECONDS : REPLAY_EVENT_LEAD_SECONDS));
    const mapped = pullToVideo(selected, target, effectiveOffset(selected, saved));
    seekToPull(mapped.kind === "mapped" ? target : seconds);
  }, [seekToPull]);

  return {
    videoRef, pullTime, duration, offsetMs, personalOffsetMs, storedPersonalOffsetMs, personalOffsetNeedsReview, seekRequest, playbackError, positionMessage,
    reloadId, preferences, seekToPull, seekToEvent, onCurrentTimeChange, onSeekComplete, onPlaybackError,
    onMediaPreferencesChange, setOffset, prepareSelection, reload: () => setReloadId((value) => value + 1),
    cancelSeek: () => {
      // 原生控件收到更新的用户意图时，撤销业务层待完成跳转。
      pending.current = null;
      setSeekRequest(null);
    },
  };
}
