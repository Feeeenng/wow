import type { HistoryRange, LiveHistoryManifest } from "@/features/live/history/model";
import { HISTORY_CONTINUITY_TOLERANCE_MS } from "@/features/live/history/config";

/** 以真实分片节目时间建立窗口，过滤上一会话和无效时长；缺口保留为独立范围。 */
export function historyRanges(manifest: LiveHistoryManifest): HistoryRange[] {
  const ranges: HistoryRange[] = [];
  for (const segment of manifest.segments) {
    const wall = Date.parse(segment.programDateTime) + (segment.programDateTimeOffsetSeconds ?? 0) * 1_000;
    const endMs = wall + segment.durationSeconds * 1_000;
    const startMs = Math.max(wall, manifest.sessionStartedAtUnixMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) continue;
    const last = ranges.at(-1);
    if (last && !segment.discontinuity && Math.abs(startMs - last.endMs) <= HISTORY_CONTINUITY_TOLERANCE_MS) last.endMs = endMs;
    else ranges.push({ startMs, endMs });
  }
  return ranges;
}

/** 严格判断绝对时间是否有已发布视频，不能用 Date.now 减开播时间补造历史。 */
export function historyCovers(ranges: HistoryRange[], unixMs: number): boolean {
  return Number.isFinite(unixMs) && ranges.filter((range) => unixMs >= range.startMs && unixMs < range.endMs).length === 1;
}

/** 将 hls.js 校正后的媒体片段位置与节目时间互换，首片 PTS 由播放器提供。 */
export function historyMediaTime(fragments: { start: number; duration: number; programDateTime: number | null }[], unixMs: number): number | null {
  const matches = fragments.filter((item) => item.programDateTime !== null && unixMs >= item.programDateTime && unixMs < item.programDateTime + item.duration * 1_000);
  const fragment = matches.length === 1 ? matches[0] : null;
  return fragment?.programDateTime == null ? null : fragment.start + (unixMs - fragment.programDateTime) / 1_000;
}
