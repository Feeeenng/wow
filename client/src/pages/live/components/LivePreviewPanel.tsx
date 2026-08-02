import { useCallback, useRef, useState } from "react";
import {
  FullscreenOutlined,
  PauseOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { Button, Empty, Spin, Tooltip } from "antd";
import type { ObsStatus } from "@/features/obs/model";
import { VirtualCameraVideo } from "@/pages/live/components/VirtualCameraVideo";

interface LivePreviewPanelProps {
  status: ObsStatus;
  deviceLabel: string | null;
  loading: boolean;
  error: string | null;
  onGoLive: () => void;
}

/** 让个人直播画面按 OBS 画布比例铺满内容区，只保留必要播放控制。 */
export function LivePreviewPanel({
  status,
  deviceLabel,
  loading,
  error,
  onGoLive,
}: LivePreviewPanelProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const handlePlaybackError = useCallback((message: string) => {
    setPlaybackError(message);
  }, []);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  return (
    <section className="aspect-video w-full overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-black shadow-sm">
      <div ref={previewRef} className="group relative h-full w-full overflow-hidden bg-black">
        {deviceLabel && !playbackError ? (
          <VirtualCameraVideo
            ref={videoRef}
            deviceLabel={deviceLabel}
            onPlayingChange={setPlaying}
            onPlaybackError={handlePlaybackError}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[#111318] px-6">
            {loading ? (
              <Spin size="large" tip="正在准备直播画面" />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={playbackError ?? error ?? status.readinessMessage}
              >
                <Button type="primary" onClick={onGoLive}>去直播</Button>
              </Empty>
            )}
          </div>
        )}

        {playing && (
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white">
            <span className="h-2 w-2 rounded-full bg-white" />
            直播中
          </div>
        )}

        {deviceLabel && !playbackError && (
          <div className="absolute inset-x-0 bottom-0 flex h-14 translate-y-full items-center justify-between bg-black/60 px-4 text-white transition-transform group-hover:translate-y-0">
            <Tooltip title={playing ? "暂停播放" : "继续播放"}>
              <Button
                type="text"
                className="text-white"
                icon={playing ? <PauseOutlined /> : <PlayCircleOutlined />}
                aria-label={playing ? "暂停播放" : "继续播放"}
                onClick={togglePlayback}
              />
            </Tooltip>
            <Tooltip title="全屏播放">
              <Button
                type="text"
                className="text-white"
                icon={<FullscreenOutlined />}
                aria-label="全屏播放"
                onClick={() => void previewRef.current?.requestFullscreen()}
              />
            </Tooltip>
          </div>
        )}
      </div>
    </section>
  );
}
