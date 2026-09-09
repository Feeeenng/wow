import Hls from "hls.js";
import { useEffect } from "react";
import type { RefObject } from "react";

interface HlsVideoProps {
  source: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  label: string;
  onCurrentTimeChange: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onPlaybackError: (message: string | null) => void;
}

/** 将 HLS VOD 挂载到 Media Chrome 使用的原生视频元素。 */
export function HlsVideo({
  source,
  videoRef,
  label,
  onCurrentTimeChange,
  onDurationChange,
  onPlaybackError,
}: HlsVideoProps) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    onPlaybackError(null);
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = source;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }
    if (!Hls.isSupported()) {
      onPlaybackError("当前系统不支持 HLS 本地回放");
      return;
    }
    const hls = new Hls();
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        onPlaybackError(`加载本地录像失败：${data.details}`);
      }
    });
    hls.loadSource(source);
    hls.attachMedia(video);
    return () => {
      hls.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [onPlaybackError, source, videoRef]);

  return (
    <video
      ref={videoRef}
      slot="media"
      className="h-full w-full object-contain"
      aria-label={label}
      preload="metadata"
      onTimeUpdate={(event) => onCurrentTimeChange(event.currentTarget.currentTime)}
      onDurationChange={(event) => {
        if (Number.isFinite(event.currentTarget.duration)) {
          onDurationChange(event.currentTarget.duration);
        }
      }}
      onError={() => onPlaybackError("本地录像无法解码或播放文件已损坏")}
    />
  );
}
