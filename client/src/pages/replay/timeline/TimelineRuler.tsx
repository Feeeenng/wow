import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/shared/replay/markers";
import { REPLAY_TIMELINE_LABEL_STEPS, REPLAY_TIMELINE_LABEL_WIDTH } from "@/features/replay/config";

/** 秒刻度由重复背景绘制；文字按实际宽度分布，不为长战斗创建逐秒DOM。 */
export function TimelineRuler({ duration }: { duration: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const seconds = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const desiredStep = seconds * REPLAY_TIMELINE_LABEL_WIDTH / Math.max(width, REPLAY_TIMELINE_LABEL_WIDTH);
  const largestStep = REPLAY_TIMELINE_LABEL_STEPS.at(-1)!;
  const step = REPLAY_TIMELINE_LABEL_STEPS.find((value) => value >= desiredStep)
    ?? Math.ceil(desiredStep / largestStep) * largestStep;
  const labels = Array.from({ length: Math.ceil(seconds / step) }, (_, index) => index * step);
  // 终点始终保留；靠近终点的中间标签让位，零点不删除。
  if (labels.length > 1 && (seconds - labels.at(-1)!) / seconds * width < REPLAY_TIMELINE_LABEL_WIDTH) labels.pop();
  if (!labels.length) labels.push(0);
  if (seconds > 0) labels.push(seconds);
  return <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
    <span />
    <div ref={root} className="replay-timeline-ruler" aria-label="每秒时间刻度"
      style={seconds > 0 && width > 0 ? { backgroundSize: `${width / seconds}px 6px, ${width / seconds * 5}px 10px` } : { backgroundImage: "none" }}>
      {labels.map((time, index) => <span key={time} data-ruler-time={time} className="absolute top-0 whitespace-nowrap text-xs tabular-nums text-[var(--app-text-secondary)]"
        style={{ left: `${seconds > 0 ? time / seconds * 100 : 0}%`, transform: index === 0 ? undefined : time === seconds ? "translateX(-100%)" : "translateX(-50%)" }}>{formatTime(time)}</span>)}
    </div>
  </div>;
}
