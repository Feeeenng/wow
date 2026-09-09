import { LoadingOutlined, VideoCameraOutlined } from "@ant-design/icons";
import {
  MediaControlBar,
  MediaController,
  MediaDurationDisplay,
  MediaFullscreenButton,
  MediaLoadingIndicator,
  MediaMuteButton,
  MediaPlaybackRateButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react";
import type { RefObject } from "react";
import type { LocalRecording } from "@/features/recording/model";
import { HlsVideo } from "@/pages/replay/components/HlsVideo";
import { isRecordingPlayable, recordingStateLabel } from "@/pages/replay/model";

interface ReplayPlayerProps {
  recording: LocalRecording;
  videoRef: RefObject<HTMLVideoElement | null>;
  playbackError: string | null;
  onCurrentTimeChange: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onPlaybackError: (message: string | null) => void;
}

function unavailableMessage(recording: LocalRecording) {
  if (recording.error) return recording.error;
  if (recording.state === "failed") return "录像处理失败，请检查本地录制诊断信息";
  if (recording.state === "interrupted") return "本场录像在完成前被下一次 Pull 中断";
  return recordingStateLabel(recording.state);
}

/** 使用 hls.js 提供媒体，并由 Media Chrome 组合本地回放控件。 */
export function ReplayPlayer({
  recording,
  videoRef,
  playbackError,
  onCurrentTimeChange,
  onDurationChange,
  onPlaybackError,
}: ReplayPlayerProps) {
  const playable = isRecordingPlayable(recording);
  const unavailable = playbackError ?? (!playable ? unavailableMessage(recording) : null);

  return (
    <section className="overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-black shadow-sm">
      <MediaController
        className="aspect-video w-full overflow-hidden bg-black [--media-button-icon-height:19px] [--media-button-icon-width:19px] [--media-control-background:transparent] [--media-control-color:#fff] [--media-control-height:20px] [--media-control-hover-background:rgba(255,255,255,0.10)] [--media-control-padding:8px] [--media-font-family:inherit] [--media-font-size:12px] [--media-icon-color:#fff] [--media-primary-color:var(--app-primary)] [--media-range-bar-color:var(--app-primary)] [--media-range-thumb-background:#fff] [--media-range-track-background:rgba(255,255,255,0.24)] [--media-range-track-height:3px] [--media-text-color:#fff]"
        defaultStreamType="on-demand"
      >
        {playable && recording.playbackUrl ? (
          <HlsVideo
            key={recording.pullId}
            source={recording.playbackUrl}
            videoRef={videoRef}
            label={`${recording.encounterName}本地回放`}
            onCurrentTimeChange={onCurrentTimeChange}
            onDurationChange={onDurationChange}
            onPlaybackError={onPlaybackError}
          />
        ) : (
          <video ref={videoRef} slot="media" aria-label={`${recording.encounterName}本地回放`} />
        )}
        {playable && !playbackError && <MediaLoadingIndicator slot="centered-chrome" />}
        {unavailable && (
          <div className="absolute inset-0 bottom-12 flex items-center justify-center bg-[#111318] px-6 text-center text-white">
            <div className="max-w-md">
              {playable || recording.state === "failed" || recording.state === "interrupted" ? (
                <VideoCameraOutlined className="mb-3 text-3xl text-white/60" />
              ) : (
                <LoadingOutlined className="mb-3 text-3xl text-white/60" />
              )}
              <strong className="block text-sm font-medium">
                {playable ? "无法播放本地录像" : recordingStateLabel(recording.state)}
              </strong>
              <span className="mt-1 block break-words text-xs leading-5 text-white/65">{unavailable}</span>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-[4px] bg-black/70 px-2.5 py-1.5 text-xs text-white">
          本机视角 · {recording.encounterName}
        </div>
        {recording.state === "partial" && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-[4px] bg-black/70 px-2.5 py-1.5 text-xs text-[#ffd666]">
            录像存在缺片
          </div>
        )}
        <MediaControlBar
          className={`h-12 w-full items-center gap-1 border-t border-white/10 bg-[rgba(12,14,20,0.92)] px-2 ${playable ? "" : "pointer-events-none opacity-60"}`}
          aria-disabled={!playable}
        >
          <MediaPlayButton />
          <MediaSeekBackwardButton seekOffset={10} />
          <MediaSeekForwardButton seekOffset={10} />
          <MediaMuteButton />
          <MediaVolumeRange className="w-16" />
          <MediaTimeDisplay />
          <span className="text-white/55">/</span>
          <MediaDurationDisplay />
          <MediaTimeRange className="mx-2 min-w-20 flex-1" />
          <MediaPlaybackRateButton />
          <MediaFullscreenButton />
        </MediaControlBar>
      </MediaController>
    </section>
  );
}
