import type { LocalTimelineEvent } from "@/shared/replay/model";
import { trackOverrideKey } from "@/shared/replay/tracks";
import { REPLAY_MARKER_EDGE_MARGIN, REPLAY_TIMELINE_MARKER_GAP } from "@/features/replay/config";

/** 仅合并同技能、同来源和同类型；相邻的不同技能换排，绝不混成一个详情。 */
export function layoutSkillMarkers(events: LocalTimelineEvent[], start: number, end: number, width: number, iconSize: number) {
  const span = end - start;
  if (span <= 0 || width <= 0) return [];
  const markers: { events: LocalTimelineEvent[]; x: number; lane: number; key: string }[] = [];
  const lastByKey = new Map<string, typeof markers[number]>();
  const laneEnds: number[] = [];
  const distance = iconSize + REPLAY_TIMELINE_MARKER_GAP;
  for (const event of [...events].sort((a, b) => a.pullTimeMs - b.pullTimeMs)) {
    const seconds = event.pullTimeMs / 1000;
    if (seconds < start || seconds > end) continue;
    const inset = iconSize / 2 + REPLAY_MARKER_EDGE_MARGIN;
    const x = Math.max(inset, Math.min(width - inset, (seconds - start) / span * width));
    const key = trackOverrideKey(event);
    const previous = lastByKey.get(key);
    if (previous && x - previous.x < distance) { previous.events.push(event); continue; }
    let lane = laneEnds.findIndex((right) => x - right >= distance);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = x;
    const marker = { events: [event], x, lane, key };
    markers.push(marker);
    lastByKey.set(key, marker);
  }
  return markers;
}
