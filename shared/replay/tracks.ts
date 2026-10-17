import type { LocalTimelineEvent } from "@/shared/replay/model";
import { eventActorKey } from "@/shared/replay/identity";
import { REPLAY_CUSTOM_TRACK_NAME_MAX, REPLAY_ICON_PERCENT, REPLAY_TIMELINE_ZOOM, REPLAY_TRACK_HEIGHT } from "@/shared/replay/config";
export interface CustomTimelineTrack { id: string; name: string; }

export interface TimelineLayout {
  customTimelineTracks: CustomTimelineTrack[];
  timelineTrackOverrides: Record<string, string>;
  timelineTrackHeight: number;
  timelineIconPercent: number;
  timelineZoom: number;
}

/** 每次生成独立空布局，调用方不得共享可变数组或规则对象。 */
export const defaultTimelineLayout = (): TimelineLayout => ({ customTimelineTracks: [], timelineTrackOverrides: {},
  timelineTrackHeight: REPLAY_TRACK_HEIGHT, timelineIconPercent: REPLAY_ICON_PERCENT, timelineZoom: REPLAY_TIMELINE_ZOOM });

export const isAura = (event: LocalTimelineEvent) => event.kind.startsWith("buff") || event.kind.startsWith("debuff");
export const timelineTracks = [
  { id: "boss", label: "敌方技能" }, { id: "player", label: "个人技能" }, { id: "team", label: "团队技能" },
  { id: "aura", label: "光环变化" }, { id: "death", label: "玩家死亡" },
] as const;

/** 以真实来源、技能和事件类型区分显示规则，不改写原事件。 */
export const trackOverrideKey = (event: LocalTimelineEvent) => `${event.owner}:${event.spellId}:${event.kind}:${eventActorKey(event, "source")}`;

export const allTimelineTracks = (custom: CustomTimelineTrack[]) => [...timelineTracks, ...custom.map((track) => ({ id: track.id, label: track.name }))];

/** 名称按Unicode字符计数，控制字符和忽略大小写的重名不能进入布局。 */
export function personalTrackNameError(name: string, custom: CustomTimelineTrack[], id?: string): string | null {
  const value = name.trim();
  if (!value || Array.from(value).length > REPLAY_CUSTOM_TRACK_NAME_MAX || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return `轨道名称应为 1–${REPLAY_CUSTOM_TRACK_NAME_MAX} 个字符，不能包含控制字符。`;
  return custom.some((track) => track.id !== id && track.name.toLowerCase() === value.toLowerCase()) ? "已存在同名个人轨道，请使用其他名称。" : null;
}

/** 只接受当前事件和存在的目标；拖回固有轨道时删除覆盖而不是改写事件。 */
export function assignTimelineTrack(events: LocalTimelineEvent[], overrides: Record<string, string>, custom: CustomTimelineTrack[], key: string, target: string) {
  const event = events.find((item) => trackOverrideKey(item) === key);
  if (!event || !allTimelineTracks(custom).some((track) => track.id === target)) return overrides;
  const next = { ...overrides };
  if (eventTrack(event, {}) === target) delete next[key]; else next[key] = target;
  return next;
}

/** 删除个人显示轨道时，仅移除相关展示覆盖，事件集合不参与此操作。 */
export function removePersonalTrack(custom: CustomTimelineTrack[], overrides: Record<string, string>, id: string) {
  return { customTimelineTracks: custom.filter((track) => track.id !== id), timelineTrackOverrides: Object.fromEntries(Object.entries(overrides).filter(([, target]) => target !== id)) };
}

/** 轨道覆盖仅改变显示归属；未知规则退回事件固有分类。 */
export function eventTrack(event: LocalTimelineEvent, overrides: Record<string, string>, custom: CustomTimelineTrack[] = []) {
  const target = overrides[trackOverrideKey(event)];
  if (timelineTracks.some((track) => track.id === target) || custom.some((track) => track.id === target)) return target;
  return event.kind === "death" ? "death" : isAura(event) ? "aura" : event.owner;
}
