import Hls from "hls.js";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { REPLAY_PROGRESS_INTERVAL_MS } from "@/features/replay/config";
import type { ReplayPreferences } from "@/features/replay/preferences";
import type { ReplaySeekRequest } from "@/features/replay/useReplayPlayback";
import { useVideoSeek } from "@/pages/replay/components/useVideoSeek";

interface HlsVideoProps {
  source: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  label: string;
  onCurrentTimeChange: (time: number) => void;
  onPlaybackError: (message: string | null) => void;
  seekRequest: ReplaySeekRequest | null;
  preferences: ReplayPreferences;
  onSeekComplete: (id: number, time: number) => void;
  onMediaPreferencesChange: (video: HTMLVideoElement) => void;
}

/** 将 HLS VOD 挂载到 Media Chrome 使用的原生视频元素。 */
export function HlsVideo({
  source,
  videoRef,
  label,
  onCurrentTimeChange,
  onPlaybackError,
  seekRequest,
  preferences,
  onSeekComplete,
  onMediaPreferencesChange,
}: HlsVideoProps) {
  const callbacks = useRef({ onPlaybackError, onCurrentTimeChange, preferences });
  callbacks.current = { onPlaybackError, onCurrentTimeChange, preferences };
  useVideoSeek(videoRef, seekRequest, onSeekComplete, onPlaybackError);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    let active = true;
    callbacks.current.onPlaybackError(null);
    const restore = () => {
      const saved = callbacks.current.preferences;
      video.volume = saved.volume;
      video.muted = saved.muted;
      video.playbackRate = saved.playbackRate;
    };
    video.addEventListener("loadedmetadata", restore, { once: true });
    const clean = () => {
      active = false;
      video.removeEventListener("loadedmetadata", restore);
      video.removeAttribute("src");
      video.load();
    };
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      return () => {
        clean();
      };
    }
    if (!Hls.isSupported()) {
      callbacks.current.onPlaybackError("当前系统不支持 HLS 本地回放");
      return clean;
    }
    const hls = new Hls();
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (active && data.fatal) {
        callbacks.current.onPlaybackError(`加载本地录像失败：${data.details}`);
      }
    });
    hls.loadSource(source);
    hls.attachMedia(video);
    return () => {
      active = false;
      hls.destroy();
      clean();
    };
  }, [source, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let active = true;
    let frame: number | null = null;
    let animation: number | null = null;
    let lastUpdate = 0;
    const report = (now: number, time: number) => {
      if (now - lastUpdate >= REPLAY_PROGRESS_INTERVAL_MS) {
        lastUpdate = now;
        callbacks.current.onCurrentTimeChange(time);
      }
    };
    const tick: VideoFrameRequestCallback = (now, metadata) => {
      frame = null;
      if (!active || video.paused) return;
      report(now, metadata.mediaTime);
      frame = video.requestVideoFrameCallback(tick);
    };
    const fallback = (now: number) => {
      animation = null;
      if (!active || video.paused) return;
      report(now, video.currentTime);
      animation = requestAnimationFrame(fallback);
    };
    const stop = () => {
      if (frame !== null) video.cancelVideoFrameCallback(frame);
      if (animation !== null) cancelAnimationFrame(animation);
      frame = null;
      animation = null;
    };
    const start = () => {
      stop();
      if (typeof video.requestVideoFrameCallback === "function") frame = video.requestVideoFrameCallback(tick);
      else animation = requestAnimationFrame(fallback);
    };
    video.addEventListener("playing", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    return () => {
      active = false;
      stop();
      video.removeEventListener("playing", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("ended", stop);
    };
  }, [videoRef]);

  return (
    <video
      ref={videoRef}
      slot="media"
      className="h-full w-full object-contain"
      aria-label={label}
      preload="metadata"
      onTimeUpdate={(event) => onCurrentTimeChange(event.currentTarget.currentTime)}
      onVolumeChange={(event) => onMediaPreferencesChange(event.currentTarget)}
      onRateChange={(event) => onMediaPreferencesChange(event.currentTarget)}
      onError={() => onPlaybackError("本地录像无法解码或播放文件已损坏")}
    />
  );
}
