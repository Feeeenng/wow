import { REPLAY_TIMELINE_EDGE_LABEL_WIDTH, REPLAY_TIMELINE_LABEL_STEPS, REPLAY_TIMELINE_LABEL_WIDTH, REPLAY_TIMELINE_MIN_WINDOW_SECONDS, REPLAY_TIMELINE_SECOND_WIDTH } from "@/features/replay/config";
import { formatTime } from "@/shared/replay/markers";

/** 仅计算可见时间窗，画布宽度固定为视口，放大不会创建超宽DOM。 */
export function timelineWindow(duration: number, width: number, zoom: number, requestedStart: number) {
  const total = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const baseSpan = Math.min(total, Math.max(1, width) / REPLAY_TIMELINE_SECOND_WIDTH);
  const minimumSpan = Math.min(total, REPLAY_TIMELINE_MIN_WINDOW_SECONDS);
  const maxZoom = minimumSpan > 0 ? Math.max(1, baseSpan / minimumSpan) : 1;
  const scale = Number.isFinite(zoom) ? Math.min(maxZoom, Math.max(1, zoom)) : 1;
  const span = Math.max(minimumSpan, baseSpan / scale);
  const start = Math.min(Math.max(0, total - span), Math.max(0, Number.isFinite(requestedStart) ? requestedStart : 0));
  return { start, end: start + span, span, total, zoom: scale, maxZoom };
}

/** 首尾使用真实时间，内部标签对齐整秒或毫秒网格并留足文字距离。 */
export function rulerTimes(start: number, end: number, width: number) {
  const span = Math.max(0, end - start);
  const desiredStep = span * REPLAY_TIMELINE_LABEL_WIDTH / Math.max(width, REPLAY_TIMELINE_LABEL_WIDTH);
  const largest = REPLAY_TIMELINE_LABEL_STEPS.at(-1)!;
  const step = REPLAY_TIMELINE_LABEL_STEPS.find((value) => value >= desiredStep) ?? Math.ceil(desiredStep / largest) * largest;
  const endSpacing = step < 1 || end % 1 !== 0 ? REPLAY_TIMELINE_EDGE_LABEL_WIDTH : REPLAY_TIMELINE_LABEL_WIDTH;
  const labels = [start];
  for (let index = Math.ceil(start / step); index * step < end; index++) {
    const time = Math.round(index * step * 1000) / 1000;
    if ((time - labels.at(-1)!) / span * width >= REPLAY_TIMELINE_LABEL_WIDTH && (end - time) / span * width >= endSpacing) labels.push(time);
  }
  if (end > start) labels.push(end);
  return { labels, step };
}

/** 放大后保留日志毫秒，避免不同精确时间显示成相同整秒。 */
export function formatTimelineTime(time: number, milliseconds = false) {
  const rounded = Math.max(0, Math.round(time * 1000));
  return formatTime(rounded / 1000) + (milliseconds ? `.${(rounded % 1000).toString().padStart(3, "0")}` : "");
}
