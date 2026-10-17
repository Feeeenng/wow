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
import type { LocalRecording } from "@/shared/replay/model";
import type { useReplayPlayback } from "@/features/replay/useReplayPlayback";
import { HlsVideo } from "@/pages/replay/components/HlsVideo";
import { VideoAnnotations } from "@/shared/annotations/editor/VideoAnnotations";
import { useVideoAnnotations } from "@/features/replay/annotations/AnnotationProvider";
import { isRecordingPlayable, recordingStateLabel, recordingStatusLabel } from "@/pages/replay/model";

interface ReplayPlayerProps {
  recording: LocalRecording;
  playback: ReturnType<typeof useReplayPlayback>;
  source?: "local" | "team";
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
  playback,
  source = "local",
}: ReplayPlayerProps) {
  const { videoRef, playbackError } = playback;
  const annotations = useVideoAnnotations(recording);
  const playable = isRecordingPlayable(recording);
  const unavailable = playbackError ?? (!playable ? source === "team" ? recording.error ?? "云端录像尚未准备好，请等待服务器处理完成后刷新目录。" : unavailableMessage(recording) : null);

  return (
    <section className="replay-player">
      <MediaController
        className="replay-media-controller w-full overflow-hidden bg-black [--media-button-icon-height:19px] [--media-button-icon-width:19px] [--media-control-background:transparent] [--media-control-color:#fff] [--media-control-height:20px] [--media-control-hover-background:rgba(255,255,255,0.10)] [--media-control-padding:8px] [--media-font-family:inherit] [--media-font-size:12px] [--media-icon-color:#fff] [--media-primary-color:var(--app-primary)] [--media-range-bar-color:var(--app-primary)] [--media-range-thumb-background:#fff] [--media-range-track-background:rgba(255,255,255,0.24)] [--media-range-track-height:3px] [--media-text-color:#fff]"
        defaultStreamType="on-demand"
        noMutedPref
        noVolumePref
        noSubtitlesLangPref
      >
        {playable && recording.playbackUrl ? (
          <HlsVideo
            key={`${recording.pullId}-${playback.reloadId}`}
            source={recording.playbackUrl}
            videoRef={videoRef}
            label={`${recording.encounterName}${source === "team" ? "团队回放" : "本地回放"}`}
            onCurrentTimeChange={playback.onCurrentTimeChange}
            onPlaybackError={playback.onPlaybackError}
            seekRequest={playback.seekRequest}
            preferences={playback.preferences}
            onSeekComplete={playback.onSeekComplete}
            onMediaPreferencesChange={playback.onMediaPreferencesChange}
          />
        ) : (
          <video ref={videoRef} slot="media" aria-label={`${recording.encounterName}${source === "team" ? "团队回放" : "本地回放"}`} />
        )}
        {playable && !playbackError && <MediaLoadingIndicator slot="centered-chrome" />}
        {playable && <VideoAnnotations key={recording.pullId + ":" + playback.reloadId} recording={recording} playback={playback} annotations={annotations} disabled={!!playbackError || !recording.mapping || recording.mapping.clockDiscontinuous} />}
        {unavailable && (
          <div className="absolute inset-0 bottom-12 flex items-center justify-center bg-[#111318] px-6 text-center text-white">
            <div className="max-w-md">
              {playable || recording.state === "failed" || recording.state === "interrupted" ? (
                <VideoCameraOutlined className="mb-3 text-3xl text-white/60" />
              ) : (
                <LoadingOutlined className="mb-3 text-3xl text-white/60" />
              )}
              <strong className="block text-sm font-medium">
                {playable ? source === "team" ? "无法播放团队录像" : "无法播放本地录像" : recordingStatusLabel(recording)}
              </strong>
              <span className="mt-1 block break-words text-xs leading-5 text-white/65">{unavailable}</span>
            </div>
          </div>
        )}
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-[4px] bg-black/70 px-2.5 py-1.5 text-xs text-white">
          {source === "team" ? "团队视角" : recording.importedSource ? "导入视角" : "本机视角"} · {recording.playerName ?? recording.encounterName}
        </div>
        {recording.state === "partial" && (
          <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-[4px] bg-black/70 px-2.5 py-1.5 text-xs text-[#ffd666]">
            录像存在缺片
          </div>
        )}
        <MediaControlBar
          onPointerDownCapture={playback.cancelSeek}
          onKeyDownCapture={playback.cancelSeek}
          className={`relative z-30 h-12 w-full items-center gap-1 border-t border-white/10 bg-[rgba(12,14,20,0.92)] px-2 ${playable ? "" : "pointer-events-none opacity-60"}`}
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
