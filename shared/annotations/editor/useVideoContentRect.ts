import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { videoContentRect } from "@/shared/annotations/model";

/** 只在视频尺寸及容器改变时测量并排除黑边，媒体控件由独立层级保持可操作。 */
export function useVideoContentRect(videoRef: RefObject<HTMLVideoElement | null>, source: string | null) {
  const [rect, setRect] = useState<ReturnType<typeof videoContentRect>>(null);
  useEffect(() => {
    const video = videoRef.current;
    const parent = video?.parentElement;
    if (!video || !parent) return;
    const measure = () => {
      const box = video.getBoundingClientRect(), container = parent.getBoundingClientRect();
      setRect(videoContentRect({ left: box.left - container.left, top: box.top - container.top, width: box.width, height: box.height }, video.videoWidth, video.videoHeight));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(video); observer.observe(parent);
    video.addEventListener("loadedmetadata", measure); video.addEventListener("resize", measure);
    document.addEventListener("fullscreenchange", measure); measure();
    return () => { observer.disconnect(); video.removeEventListener("loadedmetadata", measure); video.removeEventListener("resize", measure); document.removeEventListener("fullscreenchange", measure); };
  }, [videoRef, source]);
  return rect;
}
