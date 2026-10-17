import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { REPLAY_END_MARGIN_SECONDS, REPLAY_SEEK_TIMEOUT_MS, REPLAY_SEEK_TOLERANCE_SECONDS } from "@/features/replay/config";
import type { ReplaySeekRequest } from "@/features/replay/useReplayPlayback";

/** 媒体未就绪时等待，连续请求只完成最后一个，不用旧 seeked 确认新目标。 */
export function useVideoSeek(
  videoRef: RefObject<HTMLVideoElement | null>,
  request: ReplaySeekRequest | null,
  onComplete: (id: number, seconds: number) => void,
  onError: (message: string | null) => void,
) {
  const callbacks = useRef({ onComplete, onError });
  callbacks.current = { onComplete, onError };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !request) return;
    let active = true;
    let applied = false;
    let target = request.seconds;

    const finish = () => {
      if (!active || !applied || video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (Math.abs(video.currentTime - target) > REPLAY_SEEK_TOLERANCE_SECONDS) return;
      active = false;
      callbacks.current.onComplete(request.id, video.currentTime);
      if (request.play) void video.play().catch(() => {});
    };
    const apply = () => {
      if (!active || applied || video.readyState < HTMLMediaElement.HAVE_METADATA
        || !Number.isFinite(video.duration) || video.duration <= 0) return;
      if (target < 0 || target > video.duration) {
        active = false;
        callbacks.current.onError("目标战斗时间超出实际视频范围，请检查录像校准。");
        return;
      }
      target = Math.min(target, Math.max(0, video.duration - REPLAY_END_MARGIN_SECONDS));
      // VOD 可以定位到尚未缓冲的片段，由 hls.js 加载；不能等待 buffered 才 seek。
      try {
        applied = true;
        video.currentTime = target;
        finish();
      } catch {
        applied = false;
      }
    };
    const readyEvents = ["loadedmetadata", "durationchange", "progress", "canplay"];
    readyEvents.forEach((event) => video.addEventListener(event, apply));
    video.addEventListener("seeked", finish);
    video.addEventListener("loadeddata", finish);
    video.addEventListener("canplay", finish);
    const timer = window.setTimeout(() => {
      if (active) {
        active = false;
        callbacks.current.onError("等待录像定位超时，可重新加载后再试。");
      }
    }, REPLAY_SEEK_TIMEOUT_MS);
    apply();
    return () => {
      active = false;
      window.clearTimeout(timer);
      readyEvents.forEach((event) => video.removeEventListener(event, apply));
      video.removeEventListener("seeked", finish);
      video.removeEventListener("loadeddata", finish);
      video.removeEventListener("canplay", finish);
    };
  }, [request, videoRef]);
}
