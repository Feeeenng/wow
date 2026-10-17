import type { LocalTimelineEvent } from "@/shared/replay/model";
import { REPLAY_ICON_GAP, REPLAY_ICON_SIZE } from "@/shared/replay/config";

export const formatTime = (value: number) => `${Math.floor(Math.max(0, value) / 60)}:${Math.floor(Math.max(0, value) % 60).toString().padStart(2, "0")}`;
export const position = (time: number, duration: number) => duration > 0 ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
/** 图标分组只改变展示，不合并或重写原事件与目标身份。 */
export function groupMarkers(events: LocalTimelineEvent[], duration: number, width: number, iconSize = REPLAY_ICON_SIZE) {
  const groups: { events: LocalTimelineEvent[]; percent: number }[] = [];
  for (const event of [...events].sort((a, b) => a.pullTimeMs - b.pullTimeMs)) {
    const percent = position(event.pullTimeMs / 1_000, duration);
    const previous = groups[groups.length - 1];
    if (previous && (percent - previous.percent) / 100 * width < iconSize + REPLAY_ICON_GAP) previous.events.push(event);
    else groups.push({ events: [event], percent });
  }
  return groups;
}
