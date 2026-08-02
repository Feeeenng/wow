import { useCallback, useState } from "react";
import {
  MediaControlBar,
  MediaController,
  MediaFullscreenButton,
  MediaLiveButton,
  MediaLoadingIndicator,
  MediaMuteButton,
  MediaPlayButton,
  MediaTimeDisplay,
  MediaVolumeRange,
} from "media-chrome/react";
import type { PersonalLiveSession } from "@/features/live/model";
import { WhepVideo } from "@/pages/live/components/WhepVideo";

interface LiveMediaPlayerProps {
  session: PersonalLiveSession;
  visible: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackError: (message: string) => void;
}

/** 使用 Media Chrome 组合直播控件，媒体源适配仍由独立组件负责。 */
export function LiveMediaPlayer({
  session,
  visible,
  onPlayingChange,
  onPlaybackError,
}: LiveMediaPlayerProps) {
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [volumePercent, setVolumePercent] = useState(100);
  const handleAudioAvailabilityChange = useCallback((available: boolean) => {
    setAudioAvailable(available);
  }, []);
  const handleVolumeChange = useCallback((nextVolumePercent: number) => {
    setVolumePercent(nextVolumePercent);
  }, []);

  return (
    <MediaController
      className="h-full w-full overflow-hidden bg-black [--media-button-icon-height:20px] [--media-button-icon-width:20px] [--media-control-background:transparent] [--media-control-color:#fff] [--media-control-height:20px] [--media-control-hover-background:rgba(255,255,255,0.10)] [--media-control-padding:8px] [--media-font-family:inherit] [--media-font-size:12px] [--media-font-weight:500] [--media-icon-color:#fff] [--media-live-button-indicator-color:var(--app-live-accent)] [--media-primary-color:var(--app-live-accent)] [--media-range-bar-color:var(--app-live-accent)] [--media-range-thumb-background:#fff] [--media-range-thumb-height:10px] [--media-range-thumb-width:10px] [--media-range-track-background:rgba(255,255,255,0.24)] [--media-range-track-border-radius:2px] [--media-range-track-height:3px] [--media-text-color:#fff]"
      defaultStreamType="live"
    >
      <WhepVideo
        session={session}
        visible={visible}
        onPlayingChange={onPlayingChange}
        onAudioAvailabilityChange={handleAudioAvailabilityChange}
        onVolumeChange={handleVolumeChange}
        onPlaybackError={onPlaybackError}
      />
      <MediaLoadingIndicator slot="centered-chrome" />
      <MediaControlBar className="h-12 w-full items-center gap-1 border-t border-white/10 bg-[rgba(12,14,20,0.9)] px-2 backdrop-blur-sm">
        <MediaPlayButton />
        {audioAvailable && (
          <div className="group/volume relative flex h-full items-center">
            <MediaMuteButton />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-30 flex w-12 -translate-x-1/2 flex-col items-center rounded-[4px] border border-white/10 bg-[rgba(12,14,20,0.96)] py-2 opacity-0 shadow-lg transition-opacity duration-150 group-focus-within/volume:pointer-events-auto group-focus-within/volume:opacity-100 group-hover/volume:pointer-events-auto group-hover/volume:opacity-100">
              <span className="mb-1 text-xs tabular-nums text-white/85">{volumePercent}</span>
              <div className="relative h-20 w-8">
                <MediaVolumeRange className="absolute left-1/2 top-1/2 h-8 w-20 -translate-x-1/2 -translate-y-1/2 -rotate-90" />
              </div>
            </div>
          </div>
        )}
        <MediaTimeDisplay className="px-1 text-xs tabular-nums text-white/80" />
        <span className="flex-1" />
        <MediaLiveButton />
        <MediaFullscreenButton />
      </MediaControlBar>
    </MediaController>
  );
}
