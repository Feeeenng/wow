import { useEffect, useRef, useState } from "react";
import { formatTimelineTime, rulerTimes } from "@/pages/replay/timeline/viewport/model";

/** 秒刻度由重复背景绘制；文字按实际宽度分布，不为长战斗创建逐秒DOM。 */
export function TimelineRuler({ start, end }: { start: number; end: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const seconds = Math.max(0, end - start);
  const { labels, step } = rulerTimes(start, end, width);
  const pixelsPerSecond = seconds > 0 ? width / seconds : 0;
  return <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
    <span />
    <div ref={root} className="replay-timeline-ruler" aria-label="每秒时间刻度"
      style={seconds > 0 && width > 0 ? { backgroundSize: `${pixelsPerSecond}px 6px, ${pixelsPerSecond * 5}px 10px`, backgroundPosition: `${-(start % 1) * pixelsPerSecond}px bottom, ${-(start % 5) * pixelsPerSecond}px bottom` } : { backgroundImage: "none" }}>
      {labels.map((time, index) => <span key={time} data-ruler-time={time} className="absolute top-0 whitespace-nowrap text-xs tabular-nums text-[var(--app-text-secondary)]"
        style={{ left: `${seconds > 0 ? (time - start) / seconds * 100 : 0}%`, transform: index === 0 ? undefined : time === end ? "translateX(-100%)" : "translateX(-50%)" }}>{formatTimelineTime(time, step < 1 || time % 1 !== 0)}</span>)}
    </div>
  </div>;
}
