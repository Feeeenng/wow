import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { REPLAY_TIMELINE_LABEL_GUTTER, REPLAY_TIMELINE_WHEEL_SCALE, REPLAY_TIMELINE_ZOOM_FACTOR } from "@/features/replay/config";
import { timelineWindow } from "@/pages/replay/timeline/viewport/model";

/** 可见时间窗支持拖动与滚轮，缩放偏好仍由上层Rust持久化。 */
export function useTimelineViewport(duration: number, zoom: number, currentTime: number, pullId: string | undefined, onZoom: (zoom: number) => void, onTimeChange?: (seconds: number) => void) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1);
  const [requestedStart, setStart] = useState(0);
  const view = timelineWindow(duration, width, zoom, requestedStart);
  const latest = useRef({ view, width, onZoom });
  latest.current = { view, width, onZoom };
  const drag = useRef<{ x: number; start: number; seek: boolean; moved: boolean } | null>(null);
  useEffect(() => { setStart(0); drag.current = null; }, [pullId]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width - REPLAY_TIMELINE_LABEL_GUTTER)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const zoomTo = (next: number, ratio: number) => {
    const { view: current, width: available, onZoom: save } = latest.current;
    const scaled = timelineWindow(current.total, available, next, 0);
    setStart(current.start + current.span * ratio - scaled.span * ratio);
    save(scaled.zoom);
  };
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      const { view: current, width: available } = latest.current;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const ratio = Math.min(1, Math.max(0, (event.clientX - node.getBoundingClientRect().left - REPLAY_TIMELINE_LABEL_GUTTER) / available));
        zoomRef.current(current.zoom * Math.exp(-event.deltaY * REPLAY_TIMELINE_WHEEL_SCALE), ratio);
      } else if (current.span < current.total) {
        event.preventDefault();
        setStart(current.start + (event.deltaX || event.deltaY) / available * current.span);
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 1 && !event.shiftKey && !(event.target instanceof Element && event.target.closest(".replay-timeline-ruler"))) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = { x: event.clientX, start: view.start, seek: event.button === 0 && !event.shiftKey, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  // 按钮围绕当前画面缩放；用户已浏览到别处时围绕可见窗口中心，不突然跳回。
  const anchor = view.span > 0 && currentTime >= view.start && currentTime <= view.end ? (currentTime - view.start) / view.span : 0.5;
  return {
    root, view, setStart,
    zoomIn: () => zoomTo(view.zoom * REPLAY_TIMELINE_ZOOM_FACTOR, anchor),
    zoomOut: () => zoomTo(view.zoom / REPLAY_TIMELINE_ZOOM_FACTOR, anchor),
    panHandlers: {
      onPointerDownCapture: pointerDown,
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!drag.current) return;
        if (Math.abs(event.clientX - drag.current.x) > 4) drag.current.moved = true;
        if (drag.current.moved) setStart(drag.current.start - (event.clientX - drag.current.x) / width * view.span);
      },
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (drag.current?.seek && !drag.current.moved) {
          const x = event.clientX - event.currentTarget.getBoundingClientRect().left - REPLAY_TIMELINE_LABEL_GUTTER;
          onTimeChange?.(view.start + Math.min(1, Math.max(0, x / width)) * view.span);
        }
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      },
      onPointerCancel: () => { drag.current = null; },
      onLostPointerCapture: () => { drag.current = null; },
    },
  };
}
