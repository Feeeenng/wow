import { VideoCameraOutlined } from "@ant-design/icons";
import {
  MediaControlBar,
  MediaController,
  MediaDurationDisplay,
  MediaFullscreenButton,
  MediaMuteButton,
  MediaPlaybackRateButton,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react";
import type { ReplayMember } from "@/pages/replay/model";

interface ReplayPlayerProps {
  member: ReplayMember;
  currentTime: number;
  duration: number;
}

function formatTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** 组合 Media Chrome 回放控件，并为未来 HLS.js 媒体适配保留 media 插槽。 */
export function ReplayPlayer({ member, currentTime, duration }: ReplayPlayerProps) {
  return (
    <section className="overflow-hidden rounded-[6px] border border-[var(--app-border)] bg-black shadow-sm">
      <MediaController
        className="aspect-video w-full overflow-hidden bg-black [--media-button-icon-height:19px] [--media-button-icon-width:19px] [--media-control-background:transparent] [--media-control-color:#fff] [--media-control-height:20px] [--media-control-hover-background:rgba(255,255,255,0.10)] [--media-control-padding:8px] [--media-font-family:inherit] [--media-font-size:12px] [--media-icon-color:#fff] [--media-primary-color:var(--app-primary)] [--media-range-bar-color:var(--app-primary)] [--media-range-thumb-background:#fff] [--media-range-track-background:rgba(255,255,255,0.24)] [--media-range-track-height:3px] [--media-text-color:#fff]"
        defaultStreamType="on-demand"
      >
        <video slot="media" aria-label={`${member.name}的回放画面`} />
        <div className="absolute inset-0 bottom-12 flex items-center justify-center bg-[#111318] px-6 text-center text-white">
          <div className="max-w-md">
            <VideoCameraOutlined className="mb-3 text-3xl text-white/60" />
            <strong className="block text-sm font-medium">当前视角暂无可用录像</strong>
            <span className="mt-1 block text-xs leading-5 text-white/65">
              {member.name} 的录像仍在处理或尚未生成可播放媒体
            </span>
          </div>
        </div>
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-[4px] bg-black/70 px-2.5 py-1.5 text-xs text-white">
          当前视角：{member.name}
        </div>
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-[4px] bg-black/70 px-2.5 py-1.5 text-xs tabular-nums text-white">
          演示时间 {formatTime(currentTime)}
        </div>
        <MediaControlBar
          className="pointer-events-none h-12 w-full items-center gap-1 border-t border-white/10 bg-[rgba(12,14,20,0.92)] px-2 opacity-70"
          aria-disabled="true"
        >
          <MediaPlayButton />
          <MediaSeekBackwardButton seekOffset={10} />
          <MediaSeekForwardButton seekOffset={10} />
          <MediaMuteButton />
          <MediaVolumeRange className="w-16" />
          <MediaTimeDisplay mediaCurrentTime={currentTime} />
          <span className="text-white/55">/</span>
          <MediaDurationDisplay mediaDuration={duration} />
          <MediaTimeRange
            className="mx-2 min-w-20 flex-1"
            mediaCurrentTime={currentTime}
            mediaDuration={duration}
          />
          <MediaPlaybackRateButton />
          <MediaFullscreenButton />
        </MediaControlBar>
      </MediaController>
    </section>
  );
}
