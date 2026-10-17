import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Select, Spin } from "antd";
import { eventLabels } from "@/shared/replay/events";
import { eventActorKey, eventActorIsPlayer } from "@/shared/replay/identity";
import { formatTime } from "@/shared/replay/markers";
import { REPLAY_TIMELINE_ZOOM, REPLAY_TIMELINE_ZOOM_MAX } from "@/shared/replay/config";
import { allTimelineTracks, assignTimelineTrack, eventTrack } from "@/shared/replay/tracks";
import { TimelineTrack } from "@/replay/timeline/rendering/TimelineTrack";
import { TimelineSettings } from "@/replay/timeline/layout/TimelineSettings";
import { useTimelineLayout } from "@/replay/timeline/layout/TimelineProvider";
import type { useEvents } from "@/replay/timeline/useEvents";
import { TIMELINE_ZOOM_STEP } from "@/config";

interface Props { team: string; query: ReturnType<typeof useEvents>; current: number; duration: number; disabled: boolean; onTime: (seconds: number) => void; onEvent: (seconds: number, kind: string) => void; }

/** 完整标准事件按人物、类型、技能筛选；分组只影响显示，不重写事件。 */
export function EventTimeline(props: Props) {
  const [kinds, setKinds] = useState<string[]>([]), [actor, setActor] = useState<string>(), [skill, setSkill] = useState<number>();
  const { query, duration, team } = props;
  const { layout, update } = useTimelineLayout(team);
  const zoom = layout.timelineZoom;
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  useEffect(() => { setDraggingKey(null); }, [query.events, query.loading, props.disabled]);
  const tracks = useMemo(() => allTimelineTracks(layout.customTimelineTracks), [layout.customTimelineTracks]);
  const events = useMemo(() => query.events.filter((event) => event.pullTimeMs >= 0 && event.pullTimeMs <= duration * 1000), [query.events, duration]);
  const actors = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of events) for (const side of ["source", "target"] as const) {
      const key = eventActorKey(event, side);
      if (key && eventActorIsPlayer(event, side)) values.set(key, (side === "source" ? event.sourceName : event.targetName) + (key.startsWith("WCL-") ? " · #" + (side === "source" ? event.sourceActorId : event.targetActorId) : ""));
    }
    return [...values].map(([value, label]) => ({ value, label }));
  }, [events]);
  const skills = useMemo(() => [...new Map(events.filter((item) => item.spellId > 0).map((item) => [item.spellId, item.spellName])).entries()].map(([value, label]) => ({ value, label })), [events]);
  const filtered = useMemo(() => events.filter((event) => (!kinds.length || kinds.includes(event.kind)) && (!skill || event.spellId === skill)
    && (!actor || eventActorKey(event, "source") === actor || eventActorKey(event, "target") === actor)), [events, kinds, actor, skill]);
  const grouped = useMemo(() => tracks.map((track) => ({ ...track, events: filtered.filter((event) => eventTrack(event, layout.timelineTrackOverrides, layout.customTimelineTracks) === track.id) })), [filtered, tracks, layout.timelineTrackOverrides, layout.customTimelineTracks]);
  const assign = (key: string, target: string) => update((old) => {
    const rules = assignTimelineTrack(events, old.timelineTrackOverrides, old.customTimelineTracks, key, target);
    return rules === old.timelineTrackOverrides ? old : { ...old, timelineTrackOverrides: rules };
  });
  return <section className="timeline-panel">
    <div className="section-heading"><strong>战斗时间轴</strong><span>当前 {formatTime(props.current)} / {formatTime(duration)}</span>
      {!query.waiting && !query.loading && !query.error && <span className="muted">已读取 {query.total} 条</span>}
      <Button size="small" aria-label="缩小" disabled={zoom <= REPLAY_TIMELINE_ZOOM} onClick={() => update((old) => ({ ...old, timelineZoom: Math.max(REPLAY_TIMELINE_ZOOM, old.timelineZoom - TIMELINE_ZOOM_STEP) }))}>缩小</Button>
      <span>{zoom}×</span><Button size="small" aria-label="放大" disabled={zoom >= REPLAY_TIMELINE_ZOOM_MAX} onClick={() => update((old) => ({ ...old, timelineZoom: Math.min(REPLAY_TIMELINE_ZOOM_MAX, old.timelineZoom + TIMELINE_ZOOM_STEP) }))}>放大</Button>
      <TimelineSettings team={team} events={events} />
    </div>
    <div className="event-filters">
      <Select aria-label="筛选事件类型" mode="multiple" allowClear placeholder="全部事件类型" optionFilterProp="label" value={kinds}
        options={Object.entries(eventLabels).map(([value, label]) => ({ value, label }))} onChange={setKinds} disabled={query.loading || !!query.error} />
      <Select aria-label="筛选事件人物" allowClear showSearch optionFilterProp="label" placeholder="全部人物" value={actor} onChange={setActor} options={actors} />
      <Select aria-label="筛选技能" allowClear showSearch optionFilterProp="label" placeholder="全部技能" value={skill} onChange={setSkill} options={skills} />
    </div>
    {query.loading && <div role="status"><Spin size="small" /> 正在读取完整事件 {query.loaded} / {query.total}</div>}
    {query.error && <Alert type="error" showIcon message={query.error} action={<Button size="small" onClick={query.refresh}>重新读取事件</Button>} />}
    <div className="axis-scroll"><div className="axis-content" style={{ width: zoom * 100 + "%" }}>
      <div className="track-ruler"><span />{Array.from({ length: 6 }, (_, index) => <span key={index}>{formatTime(duration * index / 5)}</span>)}</div>
      {grouped.map((track) => <TimelineTrack key={track.id} {...props} label={track.label} trackId={track.id} draggingKey={draggingKey} onDraggingChange={setDraggingKey} onAssign={assign} events={query.loading || query.error ? [] : track.events} />)}
    </div></div>
    {!query.loading && !query.error && filtered.length === 0 && <p className="muted">{query.waiting ? "标准战斗事件尚未就绪，可先浏览录像。" : query.events.length ? "没有符合筛选的事件。" : "本场标准事件已完整读取，暂无关键事件。"}</p>}
  </section>;
}
