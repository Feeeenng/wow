import { useEffect, useRef } from "react";
import Hls from "hls.js";
import { MediaController, MediaControlBar, MediaPlayButton, MediaSeekBackwardButton, MediaSeekForwardButton,
  MediaMuteButton, MediaVolumeRange, MediaTimeDisplay, MediaDurationDisplay, MediaTimeRange, MediaPlaybackRateButton, MediaFullscreenButton } from "media-chrome/react";
import { Alert, Button } from "antd";
import { useSession } from "@/auth/SessionProvider";
import type { LocalRecording } from "@/shared/replay/model";
import type { usePlayback } from "@/replay/playback/usePlayback";
import { END_MARGIN_SECONDS, PROGRESS_INTERVAL_MS, SEEK_TIMEOUT_MS, SEEK_TOLERANCE_SECONDS } from "@/config";
import { VideoAnnotations } from "@/shared/annotations/editor/VideoAnnotations";
import type { AnnotationController } from "@/shared/annotations/model";

type Playback = ReturnType<typeof usePlayback>;

/** MSE媒体只在当前视角生命周期内创建；离开、换版或退出时释放全部连接。 */
function VideoSurface({ view, team, playback }: { view: LocalRecording; team: string; playback: Playback }) {
  const { api, logout } = useSession();
  const callbacks = useRef(playback); callbacks.current = playback;
  useEffect(() => {
    const video = playback.videoRef.current;
    if (!video || !api || !view.cloudPlaybackVersion) return;
    let active = true;
    callbacks.current.fail(null);
    if (!Hls.isSupported()) { callbacks.current.fail("当前浏览器不支持此回放，请使用支持媒体扩展的浏览器。"); return; }
    const hls = new Hls({ xhrSetup: (xhr, address) => api.mediaRequest(xhr, address, team, view.pullId, view.cloudPlaybackVersion!) });
    const restore = () => {
      const prefs = callbacks.current.preferences;
      video.volume = prefs.volume; video.muted = prefs.muted; video.playbackRate = prefs.rate;
    };
    video.addEventListener("loadedmetadata", restore, { once: true });
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!active || !data.fatal) return;
      if (data.response?.code === 401) logout();
      else callbacks.current.fail("录像加载失败，可能已换版、权限变化或网络中断，请重新读取。");
    });
    hls.loadSource(api.mediaUrl(team, view.pullId, view.cloudPlaybackVersion)); hls.attachMedia(video);
    return () => { active = false; video.removeEventListener("loadedmetadata", restore); hls.destroy(); video.pause(); video.removeAttribute("src"); video.load(); };
  }, [api, team, view.pullId, view.cloudPlaybackVersion]);

  useEffect(() => {
    const video = playback.videoRef.current, request = playback.seek;
    if (!video || !request) return;
    let active = true, applied = false; let target = request.seconds;
    const finish = () => {
      if (!active || !applied || video.seeking || video.readyState < 2 || Math.abs(video.currentTime - target) > SEEK_TOLERANCE_SECONDS) return;
      active = false; callbacks.current.complete(request.id, video.currentTime);
      if (request.play) void video.play().catch(() => {});
    };
    const apply = () => {
      if (!active || applied || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) return;
      if (target < 0 || target > video.duration) { active = false; callbacks.current.fail("定位超出录像范围，请检查校准。"); return; }
      target = Math.min(target, Math.max(0, video.duration - END_MARGIN_SECONDS)); applied = true; video.currentTime = target; finish();
    };
    for (const event of ["loadedmetadata", "durationchange", "progress", "canplay"]) video.addEventListener(event, apply);
    for (const event of ["seeked", "loadeddata", "canplay"]) video.addEventListener(event, finish);
    const timer = window.setTimeout(() => { if (active) { active = false; callbacks.current.fail("录像定位超时，请重新读取。"); } }, SEEK_TIMEOUT_MS);
    apply();
    return () => {
      active = false; clearTimeout(timer);
      for (const event of ["loadedmetadata", "durationchange", "progress", "canplay"]) video.removeEventListener(event, apply);
      for (const event of ["seeked", "loadeddata", "canplay"]) video.removeEventListener(event, finish);
    };
  }, [playback.seek, playback.videoRef]);

  useEffect(() => {
    const video = playback.videoRef.current; if (!video) return;
    let frame: number | null = null, last = 0;
    const tick = (now: number, metadata: VideoFrameCallbackMetadata) => {
      frame = null; if (video.paused) return;
      if (now - last >= PROGRESS_INTERVAL_MS) { last = now; callbacks.current.progress(metadata.mediaTime); }
      frame = video.requestVideoFrameCallback(tick);
    };
    const stop = () => { if (frame !== null) video.cancelVideoFrameCallback(frame); frame = null; };
    const start = () => { stop(); if (video.requestVideoFrameCallback) frame = video.requestVideoFrameCallback(tick); };
    video.addEventListener("playing", start); video.addEventListener("pause", stop);
    return () => { stop(); video.removeEventListener("playing", start); video.removeEventListener("pause", stop); };
  }, [playback.videoRef]);
  return <video ref={playback.videoRef} slot="media" preload="metadata" aria-label="团队回放"
    onTimeUpdate={(event) => playback.progress(event.currentTarget.currentTime)}
    onVolumeChange={(event) => playback.mediaPreferences(event.currentTarget)} onRateChange={(event) => playback.mediaPreferences(event.currentTarget)}
    onError={() => playback.fail("录像无法解码，请重新读取或选择其他视角。")} />;
}

export function ReplayPlayer({ view, team, playback, annotations, onReload }: { view: LocalRecording; team: string; playback: Playback; annotations: AnnotationController; onReload: () => void }) {
  const ready = view.state === "ready" && !!view.cloudPlaybackVersion;
  return <section className="player-panel">
    <MediaController className="media-controller" defaultStreamType="on-demand" noMutedPref noVolumePref noSubtitlesLangPref>
      {ready ? <VideoSurface key={view.pullId + ":" + view.cloudPlaybackVersion} view={view} team={team} playback={playback} />
        : <video slot="media" aria-label="等待团队录像" />}
      <span className="view-label">团队视角 · {view.playerName}</span>
      {view.mapping?.hasGap && <span className="gap-label">存在缺片</span>}
      {ready && <VideoAnnotations key={"annotations:" + view.pullId + ":" + view.cloudPlaybackVersion} recording={view} annotations={annotations}
        playback={{ videoRef: playback.videoRef, pullTime: playback.time, offsetMs: playback.offset, seekToPull: playback.request }}
        disabled={!!playback.error || !view.mapping || view.mapping.clockDiscontinuous} />}
      {!ready && <div className="player-placeholder">{view.error ?? "此视角尚未准备好，可选择其他成员录像。"}</div>}
      <MediaControlBar className="media-controls" aria-disabled={!ready} onPointerDownCapture={playback.cancelSeek} onKeyDownCapture={playback.cancelSeek}>
        <MediaPlayButton /><MediaSeekBackwardButton seekOffset={10} /><MediaSeekForwardButton seekOffset={10} />
        <MediaMuteButton /><MediaVolumeRange className="volume-control" /><MediaTimeDisplay /><span>/</span><MediaDurationDisplay />
        <MediaTimeRange className="time-range" /><MediaPlaybackRateButton /><MediaFullscreenButton />
      </MediaControlBar>
    </MediaController>
    {view.mapping?.clockDiscontinuous && <Alert type="warning" showIcon message="录制时钟发生不连续，不能按战斗时间定位，仍可浏览视频。" />}
    {playback.error && <Alert type="error" showIcon message={playback.error} action={<Button size="small" onClick={onReload}>重新加载</Button>} />}
    {playback.message && <Alert type="warning" showIcon message={playback.message} />}
  </section>;
}
