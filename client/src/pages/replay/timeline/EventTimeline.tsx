import { useMemo } from "react";
import { Alert, Button, Spin, theme } from "antd";
import { ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { isAura } from "@/shared/replay/tracks";
import { formatTime } from "@/shared/replay/markers";
import { TimelineTrack } from "@/pages/replay/timeline/TimelineTrack";
import { TimelineRuler } from "@/pages/replay/timeline/TimelineRuler";
import { REPLAY_TIMELINE_SECOND_WIDTH } from "@/features/replay/config";
import { useSpellMetadata } from "@/features/replay/metadata/useSpellMetadata";
import { useReplayEvents } from "@/features/replay/events/useReplayEvents";
import { REPLAY_TIMELINE_ZOOM, REPLAY_TIMELINE_ZOOM_MAX } from "@/shared/replay/config";
import { TimelineAppearanceSettings } from "@/pages/replay/timeline/TimelineLayoutSettings";

interface Props {
  currentTime: number; duration: number; events: LocalTimelineEvent[];
  pullId?: string; eventRevision?: string; indexComplete?: boolean;
  success: boolean | null; disabled: boolean;
  onTimeChange: (seconds: number) => void;
  onEventTimeChange: (seconds: number, kind: LocalTimelineEventKind) => void;
  emptyMessage?: string;
  eventSource?: "local" | "cloud";
}

/** 固定展示敌方与玩家技能，不应用旧布局覆盖，也不删除原始事件。 */
export function EventTimeline({ currentTime, duration, events: fallbackEvents, pullId, eventRevision, indexComplete, success, disabled, onTimeChange, onEventTimeChange, emptyMessage, eventSource = "local" }: Props) {
  const { preferences, update } = useReplayState();
  const eventQuery = useReplayEvents(pullId, eventRevision, fallbackEvents, eventSource);
  // WCL 可能保留共同战斗范围之外的事实，显示层过滤，不把负时间夹到开战零点。
  const events = useMemo(() => eventQuery.events.filter((event) => Number.isFinite(event.pullTimeMs) && event.pullTimeMs >= 0 && event.pullTimeMs <= duration * 1000), [eventQuery.events, duration]);
  const eventsReady = !eventQuery.loading && !eventQuery.error;
  const { metadata, error } = useSpellMetadata(events);
  const { token } = theme.useToken();
  // 人物筛选隐藏后忽略旧人物偏好，避免技能被不可见条件过滤。
  const filtered = useMemo(() => events.filter((event) => !isAura(event) && event.kind !== "death" && event.kind !== "resurrect"), [events]);
  // 播放游标持续更新时复用事件分轨，避免每一帧重新扫描并排序整场日志。
  // player 已由当前录像的角色GUID／WCL绑定判定，不混入团队技能或按职业猜测。
  const tracks = useMemo(() => {
    return [
      { trackId: "boss", label: "Boss技能", color: token.colorWarning, events: filtered.filter((event) => event.owner === "boss") },
      { trackId: "player", label: "玩家技能", color: token.colorPrimary, events: filtered.filter((event) => event.owner === "player") },
    ];
  }, [filtered, token.colorWarning, token.colorPrimary]);
  return <section className="min-w-0 space-y-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-[var(--app-text-secondary)]">当前 {formatTime(currentTime)} / {formatTime(duration)}</span>
        <Button size="small" type="text" icon={<ZoomOutOutlined />} aria-label="缩小战斗时间轴" disabled={preferences.timelineZoom <= REPLAY_TIMELINE_ZOOM} onClick={() => update((value) => ({ ...value, timelineZoom: Math.max(REPLAY_TIMELINE_ZOOM, value.timelineZoom - 0.5) }))} />
        <span className="text-xs tabular-nums">{preferences.timelineZoom}×</span>
        <Button size="small" type="text" icon={<ZoomInOutlined />} aria-label="放大战斗时间轴" disabled={preferences.timelineZoom >= REPLAY_TIMELINE_ZOOM_MAX} onClick={() => update((value) => ({ ...value, timelineZoom: Math.min(REPLAY_TIMELINE_ZOOM_MAX, value.timelineZoom + 0.5) }))} />
        <TimelineAppearanceSettings />
      </div>
    </div>
    {error && <Alert type="warning" showIcon message="图标资料暂不可用，仍可查看和定位日志事件" description={error} />}
    {eventQuery.loading && <div role="status" className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]"><Spin size="small" />正在读取完整事件索引 {eventQuery.loaded} / {eventQuery.total}</div>}
    {eventQuery.error && <Alert type="error" showIcon message="事件索引读取失败" description={eventQuery.error}
      action={<Button size="small" onClick={eventQuery.refresh}>重新读取事件</Button>} />}
    {indexComplete === false && eventsReady && <Alert type="info" showIcon message="当前为已观测事件，活动战斗会继续追加；旧日志缺失或解析异常可能导致索引不完整。" />}
    <div className="replay-axis-scroll" aria-label="可横向滚动的战斗时间轴">
    <div className="replay-axis-content" style={{ width: `${preferences.timelineZoom * 100}%`, minWidth: `calc(100px + ${Math.max(0, duration) * REPLAY_TIMELINE_SECOND_WIDTH * preferences.timelineZoom}px)` }}>
    <TimelineRuler duration={duration} />
    <div className="replay-tracks">{tracks.map((track) => <TimelineTrack key={track.trackId}
      {...track} events={eventsReady ? track.events : []} metadata={metadata} currentTime={currentTime} duration={duration} disabled={disabled} onTimeChange={onTimeChange} onEventTimeChange={onEventTimeChange} />)}</div>
    {eventsReady && filtered.length === 0 && <p className="text-xs text-[var(--app-text-secondary)]">{emptyMessage ?? "当前已加载事件中没有符合筛选的关键事件。"}</p>}
    <div className="flex justify-between pl-[100px] text-xs text-[var(--app-text-secondary)]"><span>开战 0:00</span><span>{success ? "击杀" : "战斗结束"} {formatTime(duration)}</span></div>
    </div>
    </div>
  </section>;
}
