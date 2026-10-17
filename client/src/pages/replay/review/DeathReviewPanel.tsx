import { Alert, Button, Drawer, Select, Space, Spin } from "antd";
import { useCallback } from "react";
import type { LocalRecording } from "@/shared/replay/model";
import { formatTime } from "@/shared/replay/markers";
import { pullToVideo } from "@/shared/replay/mapping";
import { effectiveOffset } from "@/shared/replay/calibration";
import { useDeathReview } from "@/features/replay/review/DeathReviewProvider";
import { reviewScopeMatches, reviewViewTarget } from "@/features/replay/review/navigation";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { useSpellMetadata } from "@/features/replay/metadata/useSpellMetadata";
import { DeathReviewSummary } from "@/pages/replay/review/DeathReviewSummary";
import { DeathHealthSamples } from "@/pages/replay/review/DeathHealthSamples";
import { DeathReviewEvents } from "@/pages/replay/review/DeathReviewEvents";
import { DeathReviewMechanics } from "@/pages/replay/review/DeathReviewMechanics";
import "@/pages/replay/review/review.css";

/** 本地死亡详情保持视频与时间轴可操作；按明确同场关系提供视角入口。 */
export function DeathReviewPanel({ recording, recordings, onNavigate, onTime }: {
  recording: LocalRecording; recordings: LocalRecording[]; onNavigate: (pullId: string, seconds: number) => void; onTime: (seconds: number) => void;
}) {
  const state = useDeathReview(), { preferences } = useReplayState();
  const visible = !!state.selection && state.open && reviewScopeMatches(recording, state.selection);
  const data = state.document?.data, loading = !!state.document?.loading, error = state.document?.error;
  const { metadata, error: iconError } = useSpellMetadata(visible && data ? data.events : []);
  const offsetMs = effectiveOffset(recording, preferences);
  // 播放游标更新不重新扫描死亡事件及光环，只有真实映射变化才更新定位能力。
  const canSeek = useCallback((seconds: number) => !!recording.playbackUrl && ["ready", "partial"].includes(recording.state)
    && pullToVideo(recording, seconds, offsetMs).kind === "mapped", [recording.playbackUrl, recording.state, recording.mapping, offsetMs]);
  if (!state.selection) return null;
  const selection = state.selection;
  const origin = recordings.find((item) => item.pullId === selection.pullId);
  const stale = selection.source === "cloud" && origin && (origin.timelineRevision ?? null) !== selection.revision;
  return <Drawer title="死亡复盘" open={visible} onClose={state.close} mask={false} size="min(680px, 80vw)" getContainer={false}
    rootClassName="death-review-drawer" styles={{ wrapper: { position: "absolute" }, body: { padding: 16 } }}>
    <Space orientation="vertical" size="middle" className="death-review-body">
      <div className="death-review-filters"><Select showSearch={{ optionFilterProp: "label" }} aria-label="选择死亡记录" value={selection.eventId} onChange={state.selectEvent}
        options={selection.choices.map((event) => ({ value: event.eventId, label: `${event.targetName || "未知人物"} · ${formatTime(event.pullTimeMs / 1000)} · ${event.pullTimeMs} ms` }))} />
        <Button aria-label="重新读取死亡明细" loading={loading} disabled={loading} onClick={state.reload}>重新读取</Button></div>
      {loading && <div role="status"><Spin size="small" /> 正在读取死亡窗口 {data?.events.length ?? 0}/{data?.total ?? "未知"}</div>}
      {error && <Alert type="error" showIcon message="死亡明细读取失败，已载入的部分仍保留" description={error} />}
      {stale && <Alert type="warning" showIcon message="标准事件版本已变化，请关闭面板并从当前时间轴重新选择死亡。" />}
      {data?.availability !== "ready" && data && <Alert type="warning" showIcon message={data.message || "死亡明细暂不可用，请检查本地日志。"} />}
      {data?.availability === "ready" && !stale && <>
        <strong>{data.death.targetName || "未知人物"} · 死亡时间 {formatTime(data.death.pullTimeMs / 1000)}</strong>
        <Space wrap><Button disabled={!canSeek(data.windowStartMs / 1000)} onClick={() => onTime(data.windowStartMs / 1000)}>回看死前窗口</Button>
          <Button disabled={!canSeek(data.death.pullTimeMs / 1000)} onClick={() => onTime(data.death.pullTimeMs / 1000)}>定位死亡时刻</Button></Space>
        <div className="death-review-views">{[...data.victimRecordingIds, ...data.relatedRecordingIds].map((id) => {
          const view = recordings.find((item) => item.pullId === id); if (!view || !reviewScopeMatches(view, selection)) return null;
          const target = reviewViewTarget(view, selection, data, preferences);
          return <Button size="small" key={id} data-review-view={id} disabled={target === null} title={target === data.death.pullTimeMs / 1000 ? "死前窗口未覆盖，将定位死亡时刻" : undefined}
            onClick={() => { if (target !== null) onNavigate(id, target); }}>{data.victimRecordingIds.includes(id) ? "本人" : "相关"} · {view.playerName || "未知人物"}视角</Button>;
        })}{!data.victimRecordingIds.length && <p>当前索引没有明确属于死者的本人录像。</p>}</div>
        <DeathReviewSummary review={data} complete={!loading && !error && data.events.length === data.total} />
        {data.sourceKind === "combatLog" ? <DeathReviewMechanics key={selection.eventId} review={data} complete={!loading && !error && data.events.length === data.total} canSeek={canSeek} onTime={onTime} />
          : <p className="text-xs text-[var(--app-text-secondary)]">WCL明细沿用报告记录口径，当前未关联本地版本减伤／耗材分类，不按名称推断。</p>}
        <DeathHealthSamples review={data} />
        {iconError && <p>技能图片暂不可用，仍可按实际记录查看和定位。</p>}
        <DeathReviewEvents key={selection.eventId} review={data} metadata={metadata} canSeek={canSeek} onTime={onTime} />
      </>}
    </Space>
  </Drawer>;
}
