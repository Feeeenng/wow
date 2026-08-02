import { forwardRef, useEffect, useRef } from "react";

interface VirtualCameraVideoProps {
  deviceLabel: string;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackError: (message: string) => void;
}

/** 将 Rust 已启动的 OBS 虚拟摄像头轨道挂载到页面视频元素。 */
export const VirtualCameraVideo = forwardRef<HTMLVideoElement, VirtualCameraVideoProps>(
  function VirtualCameraVideo(
    { deviceLabel, onPlayingChange, onPlaybackError },
    forwardedRef,
  ) {
    const localRef = useRef<HTMLVideoElement | null>(null);

    useEffect(() => {
      const video = localRef.current;
      if (!video || !navigator.mediaDevices?.getUserMedia) {
        onPlaybackError("当前 WebView 不支持本地视频设备");
        return;
      }
      let active = true;
      let stream: MediaStream | null = null;

      const attachCamera = async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const target = devices.find(
            (device) => device.kind === "videoinput" && device.label === deviceLabel,
          );
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              deviceId: target ? { exact: target.deviceId } : undefined,
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: { ideal: 30 },
            },
          });
          if (!active) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          const track = stream.getVideoTracks()[0];
          if (!track || !track.label.includes(deviceLabel)) {
            throw new Error("未找到 OBS Virtual Camera 视频设备");
          }
          video.srcObject = stream;
          await video.play();
        } catch (reason) {
          stream?.getTracks().forEach((track) => track.stop());
          onPlaybackError(
            reason instanceof Error ? `本地直播画面打开失败：${reason.message}` : String(reason),
          );
        }
      };

      void attachCamera();
      return () => {
        active = false;
        video.srcObject = null;
        stream?.getTracks().forEach((track) => track.stop());
      };
    }, [deviceLabel, onPlaybackError]);

    return (
      <video
        ref={(node) => {
          localRef.current = node;
          if (typeof forwardedRef === "function") {
            forwardedRef(node);
          } else if (forwardedRef) {
            forwardedRef.current = node;
          }
        }}
        className="h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        onPlaying={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
        onWaiting={() => onPlayingChange(false)}
      />
    );
  },
);
