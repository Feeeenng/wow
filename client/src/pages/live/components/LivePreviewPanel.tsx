import { useCallback, useEffect, useState } from "react";
import { LoadingOutlined } from "@ant-design/icons";
import { Button, Empty } from "antd";
import type { PersonalLiveSession } from "@/features/live/model";
import type { ObsStatus } from "@/features/obs/model";
import { LiveMediaPlayer } from "@/pages/live/components/LiveMediaPlayer";

interface LivePreviewPanelProps {
  status: ObsStatus;
  session: PersonalLiveSession | null;
  loading: boolean;
  error: string | null;
  visible: boolean;
  onGoLive: () => void;
}

interface LiveStartingOverlayProps {
  visible: boolean;
  preparing: boolean;
}

/** 在直播首帧出现前提供明确的动态连接反馈。 */
function LiveStartingOverlay({ visible, preparing }: LiveStartingOverlayProps) {
  return (
    <div
      className={`absolute inset-0 z-20 flex items-center justify-center bg-[#111318] text-white transition-opacity duration-500 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      aria-live="polite"
      aria-hidden={!visible}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-20 w-28 items-center justify-center border border-white/20">
          <span className="absolute left-[-1px] top-[-1px] h-5 w-5 border-l-2 border-t-2 border-[var(--app-live-accent)] animate-pulse" />
          <span className="absolute bottom-[-1px] right-[-1px] h-5 w-5 border-b-2 border-r-2 border-[var(--app-live-accent)] animate-pulse" />
          <LoadingOutlined spin className="text-3xl text-[var(--app-live-accent)]" />
        </div>
        <strong className="text-sm font-medium">
          {preparing ? "正在准备直播" : "正在接收直播画面"}
        </strong>
      </div>
    </div>
  );
}

/** 让个人直播画面铺满内容区，并组合播放器和空状态。 */
export function LivePreviewPanel({
  status,
  session,
  loading,
  error,
  visible,
  onGoLive,
}: LivePreviewPanelProps) {
  const [playing, setPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    setPlaybackError(null);
    setPlaying(false);
    setHasStarted(false);
  }, [session?.sessionId]);

  const handlePlaybackError = useCallback((message: string) => {
    setPlaybackError(message);
  }, []);

  const handlePlayingChange = useCallback((nextPlaying: boolean) => {
    setPlaying(nextPlaying);
    if (nextPlaying) {
      setHasStarted(true);
    }
  }, []);

  const waitingForFirstFrame = loading || Boolean(session && !playbackError && !hasStarted);

  return (
    <section className="aspect-video w-full overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-black shadow-sm">
      <div className="relative h-full w-full overflow-hidden bg-black">
        {session && !playbackError ? (
          <LiveMediaPlayer
            session={session}
            visible={visible}
            onPlayingChange={handlePlayingChange}
            onPlaybackError={handlePlaybackError}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[#111318] px-6 text-white [&_.ant-empty-description]:!text-white/85 [&_.ant-spin-text]:!text-white/85">
            {!loading && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={playbackError ?? error ?? status.readinessMessage}
              >
                <Button
                  className="!border-[var(--app-live-accent)] !bg-[var(--app-live-accent)] hover:!opacity-90"
                  type="primary"
                  onClick={onGoLive}
                >
                  去直播
                </Button>
              </Empty>
            )}
          </div>
        )}

        <LiveStartingOverlay
          visible={waitingForFirstFrame}
          preparing={loading || !session}
        />

        {playing && (
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white">
            <span className="h-2 w-2 rounded-full bg-white" />
            直播中
          </div>
        )}
      </div>
    </section>
  );
}
