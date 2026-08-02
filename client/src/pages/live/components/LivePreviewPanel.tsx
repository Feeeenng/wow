import { useCallback, useEffect, useState } from "react";
import { Button, Empty, Spin } from "antd";
import type { PersonalLiveSession } from "@/features/live/model";
import type { ObsStatus } from "@/features/obs/model";
import { LiveMediaPlayer } from "@/pages/live/components/LiveMediaPlayer";

interface LivePreviewPanelProps {
  status: ObsStatus;
  session: PersonalLiveSession | null;
  loading: boolean;
  error: string | null;
  onGoLive: () => void;
}

/** 让个人直播画面铺满内容区，并组合播放器和空状态。 */
export function LivePreviewPanel({
  status,
  session,
  loading,
  error,
  onGoLive,
}: LivePreviewPanelProps) {
  const [playing, setPlaying] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  useEffect(() => {
    setPlaybackError(null);
    setPlaying(false);
  }, [session?.sessionId]);

  const handlePlaybackError = useCallback((message: string) => {
    setPlaybackError(message);
  }, []);

  return (
    <section className="aspect-video w-full overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-black shadow-sm">
      <div className="relative h-full w-full overflow-hidden bg-black">
        {session && !playbackError ? (
          <LiveMediaPlayer
            session={session}
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
      </div>
    </section>
  );
}
