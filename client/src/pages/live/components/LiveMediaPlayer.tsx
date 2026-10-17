import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button } from "antd";
import { MediaControlBar, MediaController, MediaFullscreenButton, MediaLoadingIndicator, MediaMuteButton, MediaPlayButton, MediaPlaybackRateButton, MediaTimeDisplay, MediaVolumeRange } from "media-chrome/react";
import type { PersonalLiveSession } from "@/features/live/model";
import type { LiveMediaIntent, HistorySeekRequest } from "@/features/live/history/model";
import { HISTORY_LIVE_EDGE_MS } from "@/features/live/history/config";
import { historyCovers } from "@/features/live/history/mapping";
import type { useLiveHistory } from "@/features/live/history/useLiveHistory";
import { WhepVideo } from "@/pages/live/components/WhepVideo";
import { HistoryVideo } from "@/pages/live/components/HistoryVideo";
import { LiveHistoryControls } from "@/pages/live/components/LiveHistoryControls";

interface Props {
  session: PersonalLiveSession;
  visible: boolean;
  onPlayingChange: (playing: boolean) => void;
  onPlaybackError: (message: string | null) => void;
  onModeChange: (mode: "live" | "history") => void;
  history: ReturnType<typeof useLiveHistory>;
  request: HistorySeekRequest | null;
  onPositionChange: (unixMs: number | null) => void;
  onFrameReady: () => void;
}

/** 在一个媒体元素槽位切换 WHEP 与 HLS，保留音量／静音／播放意图，历史范围来自真实分片。 */
export function LiveMediaPlayer({ session, visible, onPlayingChange, onPlaybackError, onModeChange, history, request, onPositionChange, onFrameReady }: Props) {
  const [mode, setMode] = useState<"live" | "history">("live");
  const [targetMs, setTargetMs] = useState(0);
  const [seekId, setSeekId] = useState(0);
  const [positionMs, setPositionMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [transition, setTransition] = useState<string | null>(null);
  const [intent, setIntent] = useState<LiveMediaIntent>({ volume: 1, muted: true, playbackRate: 1, playing: true });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mutedBeforeHidden = useRef(true);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const initialSession = useRef(session.sessionId);
  const snapshot = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return intent;
    return { volume: video.volume, muted: visible ? video.muted : mutedBeforeHidden.current, playbackRate: video.playbackRate, playing: !video.paused };
  };
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const capture = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;
    try {
      const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch { return null; }
  };
  const retryLive = () => {
    setIntent({ ...snapshot(), playbackRate: 1 }); setRealtimeError(null); setError(null); setTransition(null);
    onPlaybackError(null); setLiveAttempt((value) => value + 1);
  };
  const goLive = () => {
    if (mode === "live") {
      if (realtimeError) retryLive();
      else { setError(null); setTransition(null); }
      setPositionMs(null); onPositionChange(null); return;
    }
    setTransition(capture()); setIntent({ ...snapshot(), playbackRate: 1 });
    setRealtimeError(null); onPlaybackError(null);
    setMode("live"); onModeChange("live"); setError(null); setPositionMs(null); onPositionChange(null);
  };
  const seek = (unixMs: number) => {
    const end = history.ranges.at(-1)?.endMs;
    if (end == null) return;
    if (unixMs >= end) { if (mode === "history") goLive(); else setError(null); return; }
    if (!historyCovers(history.ranges, unixMs)) { setError("该时段没有已发布的历史录像，请选择其他时间或返回直播。"); return; }
    setTransition(capture()); setIntent(snapshot()); setError(null);
    setTargetMs(unixMs); setPositionMs(unixMs); setMode("history"); onModeChange("history");
    setSeekId((value) => value + 1);
    onPositionChange(unixMs);
  };
  const onPosition = (unixMs: number) => {
    if (mode !== "history") return;
    setPositionMs(unixMs);
    onPositionChange(unixMs);
    const video = videoRef.current;
    const end = history.ranges.at(-1)?.endMs;
    if (video && !video.paused && end !== undefined && end - unixMs <= HISTORY_LIVE_EDGE_MS) goLive();
  };
  const onHistoryError = useCallback((message: string) => { setError(message); setTransition(null); }, []);
  const seekRef = useRef(seek);
  seekRef.current = seek;
  useEffect(() => { if (request?.sessionId === session.sessionId) seekRef.current(request.unixMs); }, [request, session.sessionId]);
  const onLiveError = useCallback((message: string) => {
    // RTC 失败只影响实时来源，保留历史清单、控件和当前媒体参数供用户切源。
    setIntent(snapshotRef.current()); setRealtimeError(message); setTransition(null);
    onPlaybackError(message); onPlayingChange(false);
  }, [onPlaybackError, onPlayingChange]);
  const onLivePlaying = useCallback((playing: boolean) => {
    onPlayingChange(playing);
    if (playing) { setTransition(null); setRealtimeError(null); onPlaybackError(null); }
  }, [onPlayingChange, onPlaybackError]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (visible) video.muted = mutedBeforeHidden.current;
    else { mutedBeforeHidden.current = video.muted; video.muted = true; }
  }, [visible]);
  useEffect(() => {
    if (initialSession.current === session.sessionId) return;
    initialSession.current = session.sessionId;
    setMode("live"); setPositionMs(null); setError(null); setRealtimeError(null); setTransition(null); onModeChange("live"); onPlaybackError(null);
  }, [session.sessionId, onModeChange, onPlaybackError]);
  useEffect(() => {
    if (mode === "history" && positionMs !== null && history.ranges.length > 0 && !historyCovers(history.ranges, positionMs)) {
      videoRef.current?.pause(); setError("当前回看片段已过期，请选择仍在窗口内的时间或返回直播。");
    }
  }, [history.manifest, mode, positionMs]);
  return <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
    <MediaController className="min-h-0 w-full flex-1 overflow-hidden bg-black [--media-control-background:transparent] [--media-control-color:#fff] [--media-control-height:20px] [--media-control-padding:8px] [--media-primary-color:var(--app-live-accent)] [--media-text-color:#fff]"
      defaultStreamType={mode === "live" ? "live" : "on-demand"}>
      {mode === "live" ? <WhepVideo key={liveAttempt} session={session} visible={visible} intent={intent} videoRef={videoRef}
        onPlayingChange={onLivePlaying} onAudioAvailabilityChange={setAudioAvailable} onVolumeChange={() => {}}
        onPlaybackError={onLiveError} /> : history.manifest && <HistoryVideo source={history.manifest.playlistUrl} targetMs={targetMs} requestId={seekId}
        videoRef={videoRef} intent={intent} visible={visible} onPosition={onPosition} onPlayingChange={onPlayingChange}
        onReady={() => { setTransition(null); onFrameReady(); }} onError={onHistoryError} />}
      <MediaLoadingIndicator slot="centered-chrome" />
      {transition && <img className="pointer-events-none absolute inset-0 h-full w-full object-cover" src={transition} alt="正在切换媒体" />}
      {error && <div className="absolute inset-x-3 top-12 z-30"><Alert type="warning" showIcon message={error} action={<Button size="small" onClick={goLive}>返回直播</Button>} /></div>}
      {mode === "live" && realtimeError && <div className="absolute inset-x-3 top-12 z-30"><Alert type="error" showIcon message="实时直播连接失败" description={realtimeError}
        action={<Button size="small" aria-label="重试直播" onClick={retryLive}>重试直播</Button>} /></div>}
      <MediaControlBar className="h-12 w-full items-center gap-1 border-t border-white/10 bg-[rgba(12,14,20,0.9)] px-2">
        <MediaPlayButton />
        {(audioAvailable || mode === "history") && <><MediaMuteButton /><MediaVolumeRange className="w-16" /></>}
        <MediaTimeDisplay /><span className="flex-1" />
        {mode === "history" && <MediaPlaybackRateButton />}
        <span className="px-2 text-xs text-white/80">{mode === "live" ? "LIVE" : "回看"}</span><MediaFullscreenButton />
      </MediaControlBar>
    </MediaController>
    <LiveHistoryControls ranges={history.ranges} mode={mode} positionMs={positionMs} error={history.error} onSeek={seek} onLive={goLive} />
  </div>;
}
