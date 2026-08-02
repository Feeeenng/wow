import { useCallback, useState } from "react";
import {
  MediaControlBar,
  MediaController,
  MediaFullscreenButton,
  MediaLiveButton,
  MediaLoadingIndicator,
  MediaMuteButton,
  MediaPipButton,
  MediaPlayButton,
  MediaTimeDisplay,
  MediaVolumeRange,
} from "media-chrome/react";
import type { PersonalLiveSession } from "@/features/live/model";
import { WhepVideo } from "@/pages/live/components/WhepVideo";

interface LiveMediaPlayerProps {
  session: PersonalLiveSession;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackError: (message: string) => void;
}

/** 使用 Media Chrome 组合直播控件，媒体源适配仍由独立组件负责。 */
export function LiveMediaPlayer({
  session,
  onPlayingChange,
  onPlaybackError,
}: LiveMediaPlayerProps) {
  const [audioAvailable, setAudioAvailable] = useState(false);
  const handleAudioAvailabilityChange = useCallback((available: boolean) => {
    setAudioAvailable(available);
  }, []);

  return (
    <MediaController
      className="h-full w-full bg-black [--media-control-background:rgba(17,17,17,0.92)] [--media-control-color:#fff] [--media-icon-color:#fff] [--media-primary-color:var(--app-live-accent)] [--media-range-bar-color:var(--app-live-accent)] [--media-range-thumb-background:var(--app-live-accent)] [--media-range-track-background:rgba(255,255,255,0.28)] [--media-text-color:#fff]"
      defaultStreamType="live"
    >
      <WhepVideo
        session={session}
        onPlayingChange={onPlayingChange}
        onAudioAvailabilityChange={handleAudioAvailabilityChange}
        onPlaybackError={onPlaybackError}
      />
      <MediaLoadingIndicator slot="centered-chrome" />
      <MediaControlBar className="w-full border-t border-white/15">
        <MediaPlayButton />
        <MediaTimeDisplay />
        <span className="flex-1" />
        <MediaLiveButton />
        {audioAvailable && <MediaMuteButton />}
        {audioAvailable && <MediaVolumeRange />}
        <MediaPipButton />
        <MediaFullscreenButton />
      </MediaControlBar>
    </MediaController>
  );
}
