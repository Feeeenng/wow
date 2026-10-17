import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { LocalRecording } from "@/shared/replay/model";
import { annotationFrameTime } from "@/shared/annotations/model";

/** 原生进度条也会进入预滚／尾滚；直接观察媒体，不能只依赖已截断的战斗游标。 */
export function useAnnotationFrameTime(videoRef: RefObject<HTMLVideoElement | null>, recording: LocalRecording, offsetMs: number) {
  const [timeMs, setTimeMs] = useState<number | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => setTimeMs(video.seeking || video.readyState < 2 ? null : annotationFrameTime(recording, video.currentTime, offsetMs));
    const events = ["timeupdate", "seeking", "seeked", "loadeddata", "emptied"];
    for (const name of events) video.addEventListener(name, update);
    update();
    return () => { for (const name of events) video.removeEventListener(name, update); };
  }, [videoRef, recording, offsetMs]);
  return timeMs;
}
