import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Select, Spin, message, theme } from "antd";
import { ZoomInOutlined, ZoomOutOutlined } from "@ant-design/icons";
import type { LocalTimelineEvent, LocalTimelineEventKind } from "@/shared/replay/model";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { spellMetadataService } from "@/features/replay/metadata/service";
import { allTimelineTracks, assignTimelineTrack, eventTrack } from "@/shared/replay/tracks";
import { eventLabels } from "@/shared/replay/events";
import { formatTime } from "@/shared/replay/markers";
import { TimelineTrack } from "@/pages/replay/timeline/TimelineTrack";
import { useSpellMetadata } from "@/features/replay/metadata/useSpellMetadata";
import { useReplayEvents } from "@/features/replay/events/useReplayEvents";
import { eventActorIsPlayer, eventActorKey } from "@/shared/replay/identity";
import { REPLAY_TIMELINE_ZOOM, REPLAY_TIMELINE_ZOOM_MAX } from "@/shared/replay/config";
import { TimelineAppearanceSettings, TimelineLayoutSettings } from "@/pages/replay/timeline/TimelineLayoutSettings";

interface Props {
  currentTime: number; duration: number; events: LocalTimelineEvent[];
  pullId?: string; eventRevision?: string; indexComplete?: boolean;
  playerName: string | null; success: boolean | null; disabled: boolean;
  onTimeChange: (seconds: number) => void;
  onEventTimeChange: (seconds: number, kind: LocalTimelineEventKind) => void;
  emptyMessage?: string;
  eventSource?: "local" | "cloud";
  onDeathReview?: (event: LocalTimelineEvent, choices: LocalTimelineEvent[]) => void;
}

/** 组合真实关键事件、持久筛选和图标；资料缺失不阻塞视频。 */
export function EventTimeline({ currentTime, duration, events: fallbackEvents, pullId, eventRevision, indexComplete, playerName, success, disabled, onTimeChange, onEventTimeChange, emptyMessage, eventSource = "local", onDeathReview }: Props) {
  const { preferences, update } = useReplayState();
  const eventQuery = useReplayEvents(pullId, eventRevision, fallbackEvents, eventSource);
  // WCL 可能保留共同战斗范围之外的事实，显示层过滤，不把负时间夹到开战零点。
  const events = useMemo(() => eventQuery.events.filter((event) => Number.isFinite(event.pullTimeMs) && event.pullTimeMs >= 0 && event.pullTimeMs <= duration * 1000), [eventQuery.events, duration]);
  const eventsReady = !eventQuery.loading && !eventQuery.error;
  const deaths = useMemo(() => events.filter((event) => event.kind === "death" && event.targetGuid.startsWith("Player-")), [events]);
  const { metadata, error, refresh } = useSpellMetadata(events);
  const [importing, setImporting] = useState(false);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  // 数据源／索引版本或可操作性变化时撤销当前拖动，避免将旧界面意图带到新场次。
  useEffect(() => setDraggingKey(null), [pullId, eventSource, eventRevision, eventQuery.loading, disabled]);
  const { token } = theme.useToken();
  const [feedback, holder] = message.useMessage();
  const definitions = useMemo(() => allTimelineTracks(preferences.customTimelineTracks), [preferences.customTimelineTracks]);
  const actors = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of events) {
      const sourceKey = eventActorKey(event, "source"), targetKey = eventActorKey(event, "target");
      if (sourceKey && eventActorIsPlayer(event, "source")) values.set(sourceKey, sourceKey.startsWith("WCL-") ? `${event.sourceName} · #${event.sourceActorId}` : event.sourceName);
      if (targetKey && eventActorIsPlayer(event, "target")) values.set(targetKey, targetKey.startsWith("WCL-") ? `${event.targetName} · #${event.targetActorId}` : event.targetName);
    }
    return [...values].map(([value, label]) => ({ value, label }));
  }, [events]);
  const filtered = useMemo(() => events.filter((event) => (preferences.eventKinds.length === 0 || preferences.eventKinds.includes(event.kind))
    && (!preferences.actorGuid || eventActorKey(event, "source") === preferences.actorGuid || eventActorKey(event, "target") === preferences.actorGuid)), [events, preferences.eventKinds, preferences.actorGuid]);
  // 播放游标持续更新时复用事件分轨，避免每一帧重新扫描并排序整场日志。
  const tracks = useMemo(() => {
    const colors = [token.colorWarning, token.colorPrimary, token.colorSuccess, token.colorInfo, token.colorError];
    return definitions.map((track, index) => ({
      trackId: track.id, label: track.id === "player" ? playerName ?? track.label : track.label,
      color: colors[index % colors.length], events: filtered.filter((event) => eventTrack(event, preferences.timelineTrackOverrides, preferences.customTimelineTracks) === track.id),
    }));
  }, [filtered, playerName, definitions, preferences.customTimelineTracks, preferences.timelineTrackOverrides, token.colorWarning, token.colorPrimary, token.colorSuccess, token.colorInfo, token.colorError]);
  const assignTrack = (key: string, trackId: string) => {
    update((value) => {
      const timelineTrackOverrides = assignTimelineTrack(events, value.timelineTrackOverrides, value.customTimelineTracks, key, trackId);
      return timelineTrackOverrides === value.timelineTrackOverrides ? value : { ...value, timelineTrackOverrides };
    });
  };
  const importMetadata = async () => {
    setImporting(true);
    try {
      const count = await spellMetadataService.import();
      if (count !== null) { void feedback.success(`技能资料已更新，当前 ${count} 项`); refresh(); }
    } catch (failure) { void feedback.error(String(failure)); }
    finally { setImporting(false); }
  };
  return <section className="min-w-0 space-y-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface)] p-4">
    {holder}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <strong className="text-sm font-medium">战斗时间轴</strong>
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums text-[var(--app-text-secondary)]">当前 {formatTime(currentTime)} / {formatTime(duration)}</span>
        <Button size="small" type="text" icon={<ZoomOutOutlined />} aria-label="缩小战斗时间轴" disabled={preferences.timelineZoom <= REPLAY_TIMELINE_ZOOM} onClick={() => update((value) => ({ ...value, timelineZoom: Math.max(REPLAY_TIMELINE_ZOOM, value.timelineZoom - 0.5) }))} />
        <span className="text-xs tabular-nums">{preferences.timelineZoom}×</span>
        <Button size="small" type="text" icon={<ZoomInOutlined />} aria-label="放大战斗时间轴" disabled={preferences.timelineZoom >= REPLAY_TIMELINE_ZOOM_MAX} onClick={() => update((value) => ({ ...value, timelineZoom: Math.min(REPLAY_TIMELINE_ZOOM_MAX, value.timelineZoom + 0.5) }))} />
        <TimelineAppearanceSettings />
      </div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Select mode="multiple" allowClear className="min-w-[180px] flex-1" aria-label="筛选事件类型" placeholder="全部事件类型"
        optionFilterProp="label"
        disabled={!eventsReady}
        options={Object.entries(eventLabels).map(([value, label]) => ({ value, label }))} value={preferences.eventKinds}
        onChange={(eventKinds) => update((current) => ({ ...current, eventKinds }))} />
      <Select allowClear className="w-44 max-w-full" aria-label="筛选事件人物" placeholder="全部人物" options={actors} value={preferences.actorGuid}
        disabled={!eventsReady}
        onChange={(actorGuid) => update((current) => ({ ...current, actorGuid: actorGuid ?? null }))} />
      <Button loading={importing} onClick={() => void importMetadata()}>导入技能资料</Button>
      <TimelineLayoutSettings events={events} />
      <Button disabled={!onDeathReview || !eventsReady || !deaths.length} title={eventSource === "cloud" ? "当前死亡明细读取本地日志，团队事件仍可按死亡点定位" : undefined}
        onClick={() => { const event = deaths.find((item) => item.pullTimeMs >= currentTime * 1000) ?? deaths.at(-1); if (event) onDeathReview?.(event, deaths); }}>死亡复盘</Button>
    </div>
    {error && <Alert type="warning" showIcon message="图标资料暂不可用，仍可查看和定位日志事件" description={error} />}
    {eventQuery.loading && <div role="status" className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]"><Spin size="small" />正在读取完整事件索引 {eventQuery.loaded} / {eventQuery.total}</div>}
    {eventQuery.error && <Alert type="error" showIcon message="事件索引读取失败" description={eventQuery.error}
      action={<Button size="small" onClick={eventQuery.refresh}>重新读取事件</Button>} />}
    {indexComplete === false && eventsReady && <Alert type="info" showIcon message="当前为已观测事件，活动战斗会继续追加；旧日志缺失或解析异常可能导致索引不完整。" />}
    <div className="replay-axis-scroll" aria-label="可横向滚动的战斗时间轴">
    <div className="replay-axis-content" style={{ width: `${preferences.timelineZoom * 100}%` }}>
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 text-xs text-[var(--app-text-secondary)]"><span /><div className="flex justify-between">{Array.from({ length: 6 }, (_, index) => <span key={index}>{formatTime(duration * index / 5)}</span>)}</div></div>
    <div className="replay-tracks">{tracks.map((track) => <TimelineTrack key={track.trackId}
      {...track} draggingKey={draggingKey} onDraggingChange={setDraggingKey} onAssign={assignTrack} events={eventsReady ? track.events : []} metadata={metadata} currentTime={currentTime} duration={duration} disabled={disabled} onTimeChange={onTimeChange} onEventTimeChange={onEventTimeChange}
      onDeathReview={onDeathReview ? (event) => onDeathReview(event, deaths) : undefined} />)}</div>
    {eventsReady && filtered.length === 0 && <p className="text-xs text-[var(--app-text-secondary)]">{emptyMessage ?? "当前已加载事件中没有符合筛选的关键事件。"}</p>}
    <div className="flex justify-between pl-[100px] text-xs text-[var(--app-text-secondary)]"><span>开战 0:00</span><span>{success ? "击杀" : "战斗结束"} {formatTime(duration)}</span></div>
    </div>
    </div>
  </section>;
}
