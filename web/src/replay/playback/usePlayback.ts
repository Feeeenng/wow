import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording } from "@/shared/replay/model";
import { effectiveOffset } from "@/shared/replay/calibration";
import { pullToVideo, videoToPull } from "@/shared/replay/mapping";
import { DEATH_LEAD_SECONDS, EVENT_LEAD_SECONDS, END_MARGIN_SECONDS } from "@/config";

export interface SeekRequest { id: number; seconds: number; play: boolean; }
export interface MemoryPreferences { offsetsMs: Record<string, number>; offsetVersions: Record<string, string>; volume: number; muted: boolean; rate: number; }
const initialPreferences: MemoryPreferences = { offsetsMs: {}, offsetVersions: {}, volume: 1, muted: true, rate: 1 };

/** 统一战斗游标与视频时间，切视角先校验覆盖；偏好只驻留当前Web进程。 */
export function usePlayback(recording: LocalRecording | null, select: (id: string) => void, initialSeconds: number) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [time, setTime] = useState(initialSeconds), [seek, setSeek] = useState<SeekRequest | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const operation = useRef(0), pending = useRef<number | null>(null);
  const intent = useRef<{ id: string; time: number; play: boolean } | null>(null);
  const bookmark = useRef(new Map<string, number>());
  const firstSelection = useRef(true);
  const current = useRef({ recording, preferences, time }); current.current = { recording, preferences, time };
  const offset = recording ? effectiveOffset(recording, preferences) : 0;
  const duration = recording?.encounterEndUnixMs == null ? 0 : Math.max(0, recording.encounterEndUnixMs - recording.encounterStartUnixMs) / 1000;

  const request = useCallback((seconds: number, play?: boolean) => {
    const value = current.current, view = value.recording;
    if (!view || view.state !== "ready" || !view.cloudPlaybackVersion || !Number.isFinite(seconds)) return;
    const end = Math.max(0, ((view.encounterEndUnixMs ?? view.encounterStartUnixMs) - view.encounterStartUnixMs) / 1000 - END_MARGIN_SECONDS);
    const target = Math.min(end, Math.max(0, seconds)), mapped = pullToVideo(view, target, effectiveOffset(view, value.preferences));
    if (mapped.kind !== "mapped") { setMessage("该战斗时间没有可用录像，已保留当前画面。"); return; }
    bookmark.current.set(view.pullId, target);
    const id = ++operation.current; pending.current = id; setMessage(null); setTime(target);
    setSeek({ id, seconds: mapped.seconds, play: play ?? (videoRef.current ? !videoRef.current.paused : false) });
  }, []);
  const selectView = (next: LocalRecording) => {
    const value = current.current, previous = value.recording;
    if (next.state !== "ready") { setMessage("该视角尚未准备好。"); return; }
    if (previous?.pullId === next.pullId) return;
    const same = Boolean(previous?.battleKey && previous.battleKey === next.battleKey);
    const target = same ? value.time : bookmark.current.get(next.pullId) ?? 0;
    if (same && pullToVideo(next, target, effectiveOffset(next, value.preferences)).kind !== "mapped") {
      setMessage("该视角不覆盖当前战斗时间，已保留原视角。"); return;
    }
    intent.current = { id: next.pullId, time: target, play: same && !!videoRef.current && !videoRef.current.paused };
    select(next.pullId);
  };
  useEffect(() => {
    pending.current = null; setSeek(null); setError(null); setMessage(null);
    if (!recording) return;
    const next = intent.current?.id === recording.pullId ? intent.current : null; intent.current = null;
    request(next?.time ?? bookmark.current.get(recording.pullId) ?? (firstSelection.current ? initialSeconds : 0), next?.play ?? false);
    firstSelection.current = false;
  }, [recording?.pullId, recording?.cloudPlaybackVersion, request]);
  const previousOffset = useRef({ id: recording?.pullId, offset });
  useEffect(() => {
    if (previousOffset.current.id === recording?.pullId && previousOffset.current.offset !== offset && recording) request(current.current.time, false);
    previousOffset.current = { id: recording?.pullId, offset };
  }, [offset, recording, request]);
  const progress = useCallback((seconds: number) => {
    const value = current.current;
    if (!value.recording || pending.current !== null) return;
    const mapped = videoToPull(value.recording, seconds, effectiveOffset(value.recording, value.preferences));
    if (mapped.kind === "mapped") {
      const end = ((value.recording.encounterEndUnixMs ?? value.recording.encounterStartUnixMs) - value.recording.encounterStartUnixMs) / 1000;
      const target = Math.min(end, Math.max(0, mapped.seconds)); setTime(target); bookmark.current.set(value.recording.pullId, target);
    }
  }, []);
  const complete = useCallback((id: number, seconds: number) => { if (pending.current === id) { pending.current = null; setSeek(null); progress(seconds); } }, [progress]);
  const personal = (value: number) => {
    if (!recording?.cloudPlaybackVersion || !Number.isSafeInteger(value)) return;
    setPreferences((old) => ({ ...old, offsetsMs: { ...old.offsetsMs, [recording.pullId]: value },
      offsetVersions: { ...old.offsetVersions, [recording.pullId]: recording.cloudPlaybackVersion! } }));
  };
  const seekEvent = (seconds: number, kind: string) => {
    if (!recording) return;
    const lead = Math.max(0, seconds - (kind === "death" ? DEATH_LEAD_SECONDS : EVENT_LEAD_SECONDS));
    request(pullToVideo(recording, lead, offset).kind === "mapped" ? lead : seconds, false);
  };
  return { videoRef, time, duration, seek, offset, preferences, error, message, request, seekEvent, selectView, progress, complete, personal,
    mediaPreferences: (video: HTMLVideoElement) => setPreferences((old) => old.volume === video.volume && old.muted === video.muted && old.rate === video.playbackRate
      ? old : { ...old, volume: video.volume, muted: video.muted, rate: video.playbackRate }),
    fail: (value: string | null) => { setError(value); if (value) { pending.current = null; setSeek(null); videoRef.current?.pause(); } },
    cancelSeek: () => { pending.current = null; setSeek(null); } };
}
