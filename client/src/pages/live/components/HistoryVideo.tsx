import Hls from "hls.js";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { HISTORY_LOAD_TIMEOUT_MS, HISTORY_BACK_BUFFER_SECONDS, HISTORY_FORWARD_BUFFER_SECONDS, HISTORY_MAX_BUFFER_SECONDS } from "@/features/live/history/config";
import { historyMediaTime } from "@/features/live/history/mapping";
import type { LiveMediaIntent } from "@/features/live/history/model";

interface Props {
  source: string;
  targetMs: number;
  requestId: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  intent: LiveMediaIntent;
  visible: boolean;
  onPosition: (unixMs: number) => void;
  onReady: () => void;
  onError: (error: string) => void;
  onPlayingChange: (playing: boolean) => void;
}

/** 按每片节目时间和 hls.js 实际 PTS 定位，避免首片不从零开始时跳错画面。 */
export function HistoryVideo({ source, targetMs, requestId, videoRef, intent, visible, onPosition, onReady, onError, onPlayingChange }: Props) {
  const current = useRef({ targetMs, intent, visible, onPosition, onReady, onError });
  current.current = { targetMs, intent, visible, onPosition, onReady, onError };
  const loader = useRef<Hls | null>(null);
  const pending = useRef(true);
  const awaitingReady = useRef(true);
  const position = useRef<(() => void) | null>(null);
  useEffect(() => {
    pending.current = true; awaitingReady.current = true; position.current?.();
    const timer = window.setTimeout(() => { if (awaitingReady.current) current.current.onError("目标历史片段已过期或加载超时，请重新选择或返回直播。"); }, HISTORY_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [targetMs, requestId]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !Hls.isSupported()) { current.current.onError("当前系统不支持直播历史回放"); return; }
    let active = true;
    let applied = false;
    const hls = new Hls({ lowLatencyMode: false, backBufferLength: HISTORY_BACK_BUFFER_SECONDS, maxBufferLength: HISTORY_FORWARD_BUFFER_SECONDS, maxMaxBufferLength: HISTORY_MAX_BUFFER_SECONDS });
    loader.current = hls;
    const apply = () => {
      if (!active || !pending.current || video.readyState < 1) return;
      const fragments = hls.latestLevelDetails?.fragments;
      if (!fragments) return;
      const target = historyMediaTime(fragments, current.current.targetMs);
      if (target === null) return;
      video.currentTime = target;
      applied = true; pending.current = false;
    };
    position.current = apply;
    const loaded = () => {
      video.volume = current.current.intent.volume;
      video.muted = current.current.visible ? current.current.intent.muted : true;
      video.playbackRate = current.current.intent.playbackRate;
      apply();
    };
    const ready = () => {
      if (!active || !awaitingReady.current || pending.current || !applied || video.seeking || video.readyState < 2) return;
      awaitingReady.current = false;
      current.current.onReady();
      onPlayingChange(!video.paused);
      if (current.current.intent.playing && video.paused) void video.play().catch(() => {});
    };
    const update = () => {
      if (!active || pending.current) return;
      const fragment = hls.latestLevelDetails?.fragments.find((item) => video.currentTime >= item.start && video.currentTime < item.start + item.duration);
      if (fragment?.programDateTime != null) current.current.onPosition(fragment.programDateTime + (video.currentTime - fragment.start) * 1_000);
    };
    hls.on(Hls.Events.LEVEL_LOADED, apply);
    hls.on(Hls.Events.LEVEL_PTS_UPDATED, apply);
    hls.on(Hls.Events.FRAG_BUFFERED, () => { apply(); ready(); });
    hls.on(Hls.Events.ERROR, (_event, data) => { if (active && data.fatal) current.current.onError(`直播历史播放失败：${data.details}`); });
    video.addEventListener("loadedmetadata", loaded);
    video.addEventListener("seeked", ready);
    video.addEventListener("canplay", ready);
    video.addEventListener("timeupdate", update);
    hls.loadSource(source); hls.attachMedia(video);
    return () => {
      active = false; position.current = null; loader.current = null;
      video.removeEventListener("loadedmetadata", loaded); video.removeEventListener("seeked", ready);
      video.removeEventListener("canplay", ready); video.removeEventListener("timeupdate", update);
      hls.destroy(); video.removeAttribute("src"); video.load();
    };
  }, [source, videoRef]);
  return <video ref={videoRef} slot="media" className="h-full w-full object-cover" aria-label="直播历史回放" playsInline
    onPlaying={() => onPlayingChange(true)} onPause={() => onPlayingChange(false)} onWaiting={() => onPlayingChange(false)} />;
}
