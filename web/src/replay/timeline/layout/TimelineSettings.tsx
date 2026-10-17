import { useEffect, useState } from "react";
import { Alert, Button, Input, InputNumber, Popover, Slider } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import type { CustomTimelineTrack } from "@/shared/replay/tracks";
import { allTimelineTracks, personalTrackNameError, removePersonalTrack, trackOverrideKey } from "@/shared/replay/tracks";
import { REPLAY_CUSTOM_TRACK_ID_PREFIX, REPLAY_CUSTOM_TRACK_LIMIT, REPLAY_CUSTOM_TRACK_INPUT_MAX_CHARS,
  REPLAY_ICON_PERCENT, REPLAY_ICON_PERCENT_MIN, REPLAY_ICON_PERCENT_MAX, REPLAY_TIMELINE_ZOOM,
  REPLAY_TRACK_HEIGHT, REPLAY_TRACK_HEIGHT_MIN, REPLAY_TRACK_HEIGHT_MAX } from "@/shared/replay/config";
import { useTimelineLayout } from "@/replay/timeline/layout/TimelineProvider";
import { LayoutPersistence } from "@/replay/timeline/layout/LayoutPersistence";
import "@/replay/timeline/layout/layout.css";

function TrackName({ track, onRename, onDelete, onClear, hasOverrides }: {
  track: CustomTimelineTrack; onRename: (name: string) => void; onDelete: () => void; onClear: () => void; hasOverrides: boolean;
}) {
  const [draft, setDraft] = useState(track.name);
  useEffect(() => setDraft(track.name), [track.name]);
  return <div className="personal-track-editor">
    <Input aria-label={"轨道名称 " + track.name} value={draft} maxLength={REPLAY_CUSTOM_TRACK_INPUT_MAX_CHARS} size="small" onChange={(event) => setDraft(event.target.value)} onPressEnter={() => onRename(draft)} />
    <Button aria-label={"保存" + track.name + "轨道名称"} size="small" disabled={draft === track.name} onClick={() => onRename(draft)}>保存名称</Button>
    <Button aria-label={"清除" + track.name + "轨道覆盖"} size="small" disabled={!hasOverrides} onClick={onClear}>清除覆盖</Button>
    <Button aria-label={"删除" + track.name + "轨道"} size="small" onClick={onDelete}>删除轨道</Button>
  </div>;
}

/** 可访问表单补充鼠标拖轨，所有操作只编辑本人的显示规则。 */
export function TimelineSettings({ team, events }: { team: string; events: LocalTimelineEvent[] }) {
  const { layout, update } = useTimelineLayout(team);
  const [name, setName] = useState(""), [error, setError] = useState<string | null>(null);
  const validate = (value: string, id?: string) => {
    const failure = personalTrackNameError(value, layout.customTimelineTracks, id); setError(failure); return failure ? null : value.trim();
  };
  const add = () => {
    const value = validate(name); if (!value || layout.customTimelineTracks.length >= REPLAY_CUSTOM_TRACK_LIMIT) return;
    update((old) => old.customTimelineTracks.length >= REPLAY_CUSTOM_TRACK_LIMIT || personalTrackNameError(value, old.customTimelineTracks) ? old
      : { ...old, customTimelineTracks: [...old.customTimelineTracks, { id: REPLAY_CUSTOM_TRACK_ID_PREFIX + crypto.randomUUID(), name: value }] }); setName("");
  };
  const definitions = allTimelineTracks(layout.customTimelineTracks);
  return <>
    <Popover title="时间轴外观" trigger="click" content={<div className="timeline-appearance-settings">
      <label htmlFor="web-track-height">轨道高度</label><InputNumber id="web-track-height" aria-label="时间轴轨道高度" min={REPLAY_TRACK_HEIGHT_MIN} max={REPLAY_TRACK_HEIGHT_MAX} precision={0}
        value={layout.timelineTrackHeight} suffix="px" onChange={(value) => { if (value !== null) update((old) => ({ ...old, timelineTrackHeight: value })); }} />
      <label htmlFor="web-icon-percent">技能图标 {layout.timelineIconPercent}%</label><Slider id="web-icon-percent" min={REPLAY_ICON_PERCENT_MIN} max={REPLAY_ICON_PERCENT_MAX}
        value={layout.timelineIconPercent} onChange={(value) => update((old) => ({ ...old, timelineIconPercent: value }))} />
      <Button size="small" onClick={() => update((old) => ({ ...old, timelineTrackHeight: REPLAY_TRACK_HEIGHT, timelineIconPercent: REPLAY_ICON_PERCENT, timelineZoom: REPLAY_TIMELINE_ZOOM }))}>恢复默认外观</Button>
    </div>}><Button size="small" icon={<SettingOutlined />} aria-label="设置时间轴外观" /></Popover>
    <Popover title="个人时间轴布局" trigger="click" content={<div className="personal-layout-settings">
      <p className="muted">个人布局按账号和团队保存，点击“保存个人布局”后可跨刷新、设备恢复。拖动同源技能或在事件详情换轨，事件事实和视频定位保持原样。</p>
      <LayoutPersistence team={team} />
      <div className="personal-track-editor"><Input size="small" aria-label="新增个人轨道名称" maxLength={REPLAY_CUSTOM_TRACK_INPUT_MAX_CHARS} value={name} placeholder="新轨道名称" onChange={(event) => setName(event.target.value)} onPressEnter={add} />
        <Button aria-label="新增个人轨道" size="small" disabled={!name.trim() || layout.customTimelineTracks.length >= REPLAY_CUSTOM_TRACK_LIMIT} onClick={add}>新增轨道</Button>
        <span>{layout.customTimelineTracks.length}/{REPLAY_CUSTOM_TRACK_LIMIT}</span></div>
      {error && <Alert type="error" showIcon message={error} />}
      <div className="personal-track-list">{layout.customTimelineTracks.map((track) => <TrackName key={track.id} track={track} hasOverrides={Object.values(layout.timelineTrackOverrides).includes(track.id)}
        onRename={(draft) => { const value = validate(draft, track.id); if (value) update((old) => ({ ...old, customTimelineTracks: old.customTimelineTracks.map((item) => item.id === track.id ? { ...item, name: value } : item) })); }}
        onClear={() => update((old) => ({ ...old, timelineTrackOverrides: Object.fromEntries(Object.entries(old.timelineTrackOverrides).filter(([, target]) => target !== track.id)) }))}
        onDelete={() => update((old) => ({ ...old, ...removePersonalTrack(old.customTimelineTracks, old.timelineTrackOverrides, track.id) }))} />)}</div>
      <div className="personal-rule-list">{Object.entries(layout.timelineTrackOverrides).map(([key, target]) => {
        const event = events.find((item) => trackOverrideKey(item) === key);
        return <div className="personal-track-editor" key={key}><span title={key}>{event?.spellName ?? key} → {definitions.find((track) => track.id === target)?.label ?? target}</span>
          <Button size="small" aria-label={"清除" + (event?.spellName ?? key) + "的轨道覆盖"} onClick={() => update((old) => {
            const rules = { ...old.timelineTrackOverrides }; delete rules[key]; return { ...old, timelineTrackOverrides: rules };
          })}>清除</Button></div>;
      })}</div>
      {!layout.customTimelineTracks.length && !Object.keys(layout.timelineTrackOverrides).length && <p>当前使用默认轨道归属。</p>}
      <Button size="small" disabled={!layout.customTimelineTracks.length && !Object.keys(layout.timelineTrackOverrides).length}
        onClick={() => update((old) => ({ ...old, customTimelineTracks: [], timelineTrackOverrides: {} }))}>恢复默认轨道布局</Button>
    </div>}><Button size="small">轨道布局</Button></Popover>
  </>;
}
