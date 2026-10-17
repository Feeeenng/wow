import { useEffect, useState } from "react";
import { Alert, Button, Input, InputNumber, Popover, Slider } from "antd";
import { CloseOutlined, SettingOutlined } from "@ant-design/icons";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import type { CustomTimelineTrack } from "@/shared/replay/tracks";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { REPLAY_CUSTOM_TRACK_ID_PREFIX, REPLAY_CUSTOM_TRACK_LIMIT, REPLAY_CUSTOM_TRACK_INPUT_MAX_CHARS, REPLAY_ICON_PERCENT, REPLAY_ICON_PERCENT_MAX, REPLAY_ICON_PERCENT_MIN, REPLAY_TIMELINE_ZOOM, REPLAY_TRACK_HEIGHT, REPLAY_TRACK_HEIGHT_MAX, REPLAY_TRACK_HEIGHT_MIN } from "@/shared/replay/config";
import { allTimelineTracks, personalTrackNameError, removePersonalTrack, trackOverrideKey } from "@/shared/replay/tracks";

/** 外观只修改个人偏好，由统一原生存储保存。 */
export function TimelineAppearanceSettings() {
  const { preferences, update } = useReplayState();
  return <Popover title="时间轴外观" trigger="click" content={<div className="replay-appearance">
    <label htmlFor="replay-track-height">轨道高度</label>
    <InputNumber id="replay-track-height" aria-label="时间轴轨道高度" min={REPLAY_TRACK_HEIGHT_MIN} max={REPLAY_TRACK_HEIGHT_MAX} precision={0} value={preferences.timelineTrackHeight} suffix="px" onChange={(timelineTrackHeight) => { if (timelineTrackHeight !== null) update((value) => ({ ...value, timelineTrackHeight })); }} />
    <label htmlFor="replay-icon-size">技能图标 {preferences.timelineIconPercent}%</label>
    <Slider id="replay-icon-size" min={REPLAY_ICON_PERCENT_MIN} max={REPLAY_ICON_PERCENT_MAX} value={preferences.timelineIconPercent} onChange={(timelineIconPercent) => update((value) => ({ ...value, timelineIconPercent }))} />
    <Button size="small" onClick={() => update((value) => ({ ...value, timelineTrackHeight: REPLAY_TRACK_HEIGHT, timelineIconPercent: REPLAY_ICON_PERCENT, timelineZoom: REPLAY_TIMELINE_ZOOM }))}>恢复默认外观</Button>
  </div>}><Button size="small" type="text" icon={<SettingOutlined />} aria-label="设置时间轴外观" /></Popover>;
}

function TrackNameEditor({ track, onRename, onDelete, onClear, hasOverrides }: {
  track: CustomTimelineTrack; onRename: (name: string) => void; onDelete: () => void; onClear: () => void; hasOverrides: boolean;
}) {
  const [name, setName] = useState(track.name);
  useEffect(() => setName(track.name), [track.name]);
  return <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--app-border)] p-2">
    <Input size="small" className="!w-36" aria-label={`轨道名称 ${track.name}`} maxLength={REPLAY_CUSTOM_TRACK_INPUT_MAX_CHARS} value={name} onChange={(event) => setName(event.target.value)} onPressEnter={() => onRename(name)} />
    <Button size="small" aria-label={`保存${track.name}轨道名称`} disabled={name === track.name} onClick={() => onRename(name)}>保存名称</Button>
    <Button size="small" aria-label={`清除${track.name}轨道覆盖`} disabled={!hasOverrides} onClick={onClear}>清除覆盖</Button>
    <Button size="small" aria-label={`删除${track.name}轨道`} onClick={onDelete}>删除轨道</Button>
  </div>;
}

/** 编辑个人显示轨道和覆盖规则，删除只恢复显示归属，绝不修改原事件。 */
export function TimelineLayoutSettings({ events }: { events: LocalTimelineEvent[] }) {
  const { preferences, update } = useReplayState();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const definitions = allTimelineTracks(preferences.customTimelineTracks);
  const validName = (draft: string, id?: string) => {
    const failure = personalTrackNameError(draft, preferences.customTimelineTracks, id);
    setError(failure); return failure ? null : draft.trim();
  };
  const add = () => {
    const label = validName(name);
    if (!label || preferences.customTimelineTracks.length >= REPLAY_CUSTOM_TRACK_LIMIT) return;
    const track = { id: `${REPLAY_CUSTOM_TRACK_ID_PREFIX}${crypto.randomUUID()}`, name: label };
    update((value) => ({ ...value, customTimelineTracks: [...value.customTimelineTracks, track] })); setName("");
  };
  const clearTarget = (id: string) => update((value) => ({ ...value, timelineTrackOverrides: Object.fromEntries(Object.entries(value.timelineTrackOverrides).filter(([, target]) => target !== id)) }));
  return <Popover title="个人时间轴布局" trigger="click" content={<div className="w-[460px] max-w-[75vw] space-y-3">
    <p className="text-xs text-[var(--app-text-secondary)]">仅调整本人的显示布局。拖动图标换轨，事件时间、回看定位和团队配置保持原样。</p>
    <div className="flex items-center gap-2"><Input size="small" aria-label="新增个人轨道名称" placeholder="新轨道名称" maxLength={REPLAY_CUSTOM_TRACK_INPUT_MAX_CHARS} value={name} onChange={(event) => setName(event.target.value)} onPressEnter={add} />
      <Button size="small" aria-label="新增个人轨道" disabled={!name.trim() || preferences.customTimelineTracks.length >= REPLAY_CUSTOM_TRACK_LIMIT} onClick={add}>新增轨道</Button>
      <span className="shrink-0 text-xs">{preferences.customTimelineTracks.length}/{REPLAY_CUSTOM_TRACK_LIMIT}</span></div>
    {error && <Alert type="error" showIcon message={error} />}
    <div className="max-h-52 space-y-2 overflow-auto">{preferences.customTimelineTracks.map((track) => <TrackNameEditor key={track.id} track={track}
      hasOverrides={Object.values(preferences.timelineTrackOverrides).includes(track.id)} onClear={() => clearTarget(track.id)}
      onRename={(draft) => { const label = validName(draft, track.id); if (label) update((value) => ({ ...value, customTimelineTracks: value.customTimelineTracks.map((item) => item.id === track.id ? { ...item, name: label } : item) })); }}
      onDelete={() => update((value) => ({ ...value, ...removePersonalTrack(value.customTimelineTracks, value.timelineTrackOverrides, track.id) }))} />)}</div>
    <div className="max-h-44 space-y-2 overflow-auto">{Object.entries(preferences.timelineTrackOverrides).map(([key, target]) => {
      const event = events.find((item) => trackOverrideKey(item) === key);
      return <div key={key} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate" title={key}>{event?.spellName ?? key} → {definitions.find((track) => track.id === target)?.label ?? target}</span>
        <Button size="small" type="text" icon={<CloseOutlined />} aria-label={`清除${event?.spellName ?? key}的轨道覆盖`} onClick={() => update((value) => { const timelineTrackOverrides = { ...value.timelineTrackOverrides }; delete timelineTrackOverrides[key]; return { ...value, timelineTrackOverrides }; })} /></div>;
    })}</div>
    {Object.keys(preferences.timelineTrackOverrides).length === 0 && preferences.customTimelineTracks.length === 0 && <p className="text-xs">当前使用默认轨道归属。</p>}
    <Button size="small" disabled={Object.keys(preferences.timelineTrackOverrides).length === 0 && preferences.customTimelineTracks.length === 0}
      onClick={() => update((value) => ({ ...value, timelineTrackOverrides: {}, customTimelineTracks: [] }))}>恢复默认轨道布局</Button>
  </div>}><Button>轨道布局</Button></Popover>;
}
