import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Alert, Button, ConfigProvider, Empty, Popover, Spin, Tooltip } from "antd";
import { FullscreenExitOutlined, FullscreenOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { useReplayCatalog } from "@/features/replay/catalog/ReplayCatalogProvider";
import { recordingService } from "@/features/recording/recordingService";
import { replayIntervals } from "@/shared/replay/mapping";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { useReplayPlayback } from "@/features/replay/useReplayPlayback";
import { EventTimeline } from "@/pages/replay/timeline/EventTimeline";
import { RecordingPanel } from "@/pages/replay/components/RecordingPanel";
import { ReplayHeader } from "@/pages/replay/components/ReplayHeader";
import { ReplayPlayer } from "@/pages/replay/components/ReplayPlayer";
import { ReplaySidebar } from "@/pages/replay/components/ReplaySidebar";
import { ReplayCalibration } from "@/pages/replay/calibration/ReplayCalibration";
import { distinctRecordingBattles, isRecordingPlayable } from "@/pages/replay/model";
import { useDeathReview } from "@/features/replay/review/DeathReviewProvider";
import { DeathReviewPanel } from "@/pages/replay/review/DeathReviewPanel";
import { reviewScopeMatches } from "@/features/replay/review/navigation";
import { RecordingImportDrawer } from "@/pages/replay/components/RecordingImportDrawer";
import { useRecordingImport } from "@/features/recording/importing/RecordingImportProvider";
import "@/pages/replay/replay.css";

/** 页面仅组合真实录像、回放控制器和战斗轴；业务进度由应用级 Provider 保留。 */
export function ReplayPage() {
  const { source, setSource, recordings, loading, refreshing, error, refresh, blockedReason, hasMore, loadMore } = useReplayCatalog();
  const { preferences, update, ready, persistenceError } = useReplayState();
  const selectedPullId = preferences.selectedPullId;
  const recording = recordings.find((item) => item.pullId === selectedPullId) ?? null;
  const playback = useReplayPlayback(recording);
  const canSeek = !!recording && replayIntervals(recording).length > 0;
  const [retryingPullId, setRetryingPullId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importer = useRecordingImport();
  const deathReview = useDeathReview();
  const refreshedImportTask = useRef<string | null>(null);
  const cloudRetryableIds = useMemo(() => new Set(source === "team" ? recordings.filter((item) => item.state === "failed" && item.canRetryProcessing === true).map((item) => item.pullId) : []), [source, recordings]);
  const canRetrySelected = !!recording && (source === "local" ? recording.state === "failed" || recording.state === "interrupted" : cloudRetryableIds.has(recording.pullId));
  const selectRecording = useCallback((pullId: string) => {
    const next = recordings.find((item) => item.pullId === pullId);
    if (next && playback.prepareSelection(next)) update((value) => ({ ...value, selectedPullId: pullId }));
  }, [recordings, playback.prepareSelection, update]);
  const retry = async (pullId = recording?.pullId) => {
    const target = recordings.find((item) => item.pullId === pullId);
    if (!target || retryingPullId !== null || (source === "team" ? !cloudRetryableIds.has(target.pullId) : target.state !== "failed" && target.state !== "interrupted")) return;
    setRetryingPullId(target.pullId); setRetryError(null);
    try {
      if (source === "team") await invoke("retry_cloud_replay_processing", { recordingId: target.pullId });
      else await recordingService.retry(target.pullId);
      await refresh();
    }
    catch (failure) { setRetryError(String(failure)); }
    finally { setRetryingPullId(null); }
  };

  useEffect(() => {
    if (!ready || loading || error || blockedReason) return;
    if (recordings.length === 0) {
      if (selectedPullId !== null) update((value) => ({ ...value, selectedPullId: null }));
    } else if (!recordings.some((item) => item.pullId === selectedPullId)) {
      update((value) => ({ ...value, selectedPullId: recordings[0].pullId }));
    }
  }, [recordings, selectedPullId, loading, ready, error, blockedReason, update]);

  useEffect(() => {
    const { taskId, status } = importer.progress;
    if (taskId && (status === "completed" || status === "cancelled") && taskId !== refreshedImportTask.current) {
      refreshedImportTask.current = taskId;
      void refresh();
    }
  }, [importer.progress, refresh]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(document.fullscreenElement === workspaceRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen();
    } catch (failure) { setRetryError(`无法切换复盘全屏：${String(failure)}`); }
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.altKey || event.ctrlKey || event.metaKey || target instanceof HTMLElement
        && target.closest("input, textarea, select, [contenteditable='true'], [role='combobox']")) return;
      if (event.code === "KeyT") { event.preventDefault(); void toggleFullscreen(); return; }
      if (event.code !== "KeyQ" && event.code !== "KeyE") return;
      const ordered = distinctRecordingBattles(recordings, selectedPullId).sort((a, b) => a.encounterStartUnixMs - b.encounterStartUnixMs);
      const index = ordered.findIndex((item) => item.pullId === selectedPullId);
      const next = index < 0 ? undefined : ordered[index + (event.code === "KeyQ" ? -1 : 1)];
      if (next) { event.preventDefault(); selectRecording(next.pullId); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [recordings, selectedPullId, selectRecording, toggleFullscreen]);

  return (
    <ConfigProvider
      getPopupContainer={(trigger) => trigger?.closest<HTMLElement>(".replay-workspace") ?? document.body}>
    <div ref={workspaceRef} className="replay-workspace">
      <ReplaySidebar recordings={recordings} selected={recording} onSelect={selectRecording} source={source} onSourceChange={setSource} hasMore={hasMore} loadingMore={refreshing} onLoadMore={() => void loadMore()}
        retryableIds={cloudRetryableIds} retryingPullId={retryingPullId} onRetry={(pullId) => void retry(pullId)} />
      <div className="replay-main">
      <ReplayHeader
        recording={recording}
        recordings={recordings}
        selectedPullId={selectedPullId}
        refreshing={refreshing}
        onRecordingChange={selectRecording}
        onRefresh={() => void refresh()}
        onImport={() => setImportOpen(true)}
        source={source}
      />
      <div className="replay-notices" aria-live="polite">
      {error && <Alert type="error" showIcon message={source === "team" ? "读取团队录像失败" : "读取本地录像失败"} description={error}
        action={<Button size="small" onClick={() => void refresh()}>重新读取</Button>} />}
      {persistenceError && <Alert type="warning" showIcon message="回放偏好未能保存" description={persistenceError} />}
      {retryError && <Alert type="error" showIcon message="重试处理失败" description={retryError} />}
      </div>
      {loading || !ready ? (
        <section className="replay-empty">
          <Spin tip={source === "team" ? "正在读取团队录像" : "正在读取本地录像"} size="large" />
        </section>
      ) : recording ? (
        <div className="replay-content">
          <div className="replay-video-stage">
            <ReplayPlayer recording={recording} playback={playback} source={source} />
          </div>
          <div className="replay-review-tools">
            <Popover title="录像状态" trigger="click" content={<RecordingPanel recording={recording} retrying={retryingPullId === recording.pullId} onRetry={() => void retry()} source={source} canRetry={canRetrySelected} />}>
              <Button size="small" icon={<InfoCircleOutlined />}>录像信息</Button>
            </Popover>
            {canRetrySelected && <Button size="small" aria-label={source === "team" ? "重试云端处理" : "重试处理"} loading={retryingPullId === recording.pullId} disabled={retryingPullId !== null} onClick={() => void retry()}>{source === "team" ? "重试云端处理" : "重试处理"}</Button>}
            <span className="replay-review-hint">{recording.mapping?.mediaCalibrated ? "媒体映射已校准，日志与画面可按需微调" : "自动对齐为估算，可按实际画面微调"}</span>
            <Tooltip title={fullscreen ? "退出复盘全屏" : "全屏显示视频和战斗轴"}>
              <Button size="small" type="text" icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} aria-label="切换复盘全屏" onClick={() => void toggleFullscreen()} />
            </Tooltip>
          </div>
          <div className="replay-playback-notices">
            {recording.mapping?.clockDiscontinuous && <Alert type="warning" showIcon message="录制时间发生不连续，战斗时间定位已禁用，仍可使用视频进度条浏览。" />}
            {playback.playbackError && <Alert type="error" showIcon message={playback.playbackError}
              action={<Button size="small" onClick={playback.reload}>重新加载</Button>} />}
            {playback.positionMessage && <Alert type="warning" showIcon message={playback.positionMessage} />}
            {recording.timelineParseErrors > 0 && <Alert type="warning" showIcon message={`日志中有 ${recording.timelineParseErrors} 行关键事件未能解析，事件索引可能不完整。`} />}
            {isRecordingPlayable(recording) && (
              <ReplayCalibration key={recording.pullId} recording={recording} playback={playback} disabled={!canSeek} />
            )}
          </div>
          <div className="replay-timeline-stage">
            <EventTimeline
              pullId={recording.pullId}
              eventRevision={recording.timelineRevision}
              eventSource={recording.sourceKind === "cloud" ? "cloud" : "local"}
              indexComplete={source === "team" && !recording.timelineRevision ? undefined : recording.timelineComplete}
              currentTime={playback.pullTime}
              duration={playback.duration}
              events={recording.timelineEvents ?? []}
              playerName={recording.playerName}
              success={recording.success}
              disabled={!canSeek || !isRecordingPlayable(recording) || playback.playbackError !== null}
              onTimeChange={playback.seekToPull}
              onEventTimeChange={playback.seekToEvent}
              onDeathReview={source === "local" ? (event, choices) => deathReview.show({ pullId: recording.pullId, battleKey: recording.battleKey ?? null, eventId: event.eventId, choices }) : undefined}
              emptyMessage={source === "team" && recording.timelineEvents.length === 0 && !recording.timelineRevision ? "等待标准战斗事件" : undefined}
            />
          </div>
        </div>
      ) : (
        <section className="replay-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={blockedReason ?? (source === "team" ? "当前授权团队暂无录像" : "当前没有本地 Boss 录像")} />
        </section>
      )}
      </div>
      {recording && <DeathReviewPanel recording={recording} recordings={recordings} onTime={playback.seekToPull} onNavigate={(pullId, seconds) => {
        const next = recordings.find((item) => item.pullId === pullId);
        if (!next || !deathReview.selection || !reviewScopeMatches(next, deathReview.selection)) return;
        if (pullId === recording.pullId) playback.seekToPull(seconds);
        else if (playback.prepareSelection(next, seconds)) update((value) => ({ ...value, selectedPullId: pullId }));
      }} />}
      <RecordingImportDrawer open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
    </ConfigProvider>
  );
}
