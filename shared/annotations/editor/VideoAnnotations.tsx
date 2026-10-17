import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, RefObject } from "react";
import "@/shared/annotations/editor/editor.css";
import type { LocalRecording } from "@/shared/replay/model";
import { annotationFrameTime, visibleAnnotations } from "@/shared/annotations/model";
import type { AnnotationController, AnnotationPoint, VideoAnnotation } from "@/shared/annotations/model";
import { ANNOTATION_DEFAULT_COLOR, ANNOTATION_DEFAULT_DURATION_MS, ANNOTATION_DEFAULT_WIDTH, ANNOTATION_MAX_ITEMS, ANNOTATION_MAX_POINTS, ANNOTATION_POINT_STEP_PX } from "@/shared/annotations/config";
import { AnnotationShape } from "@/shared/annotations/editor/AnnotationShape";
import { AnnotationToolbar } from "@/shared/annotations/editor/AnnotationToolbar";
import type { AnnotationStyle, DrawingTool } from "@/shared/annotations/editor/AnnotationToolbar";
import { useVideoContentRect } from "@/shared/annotations/editor/useVideoContentRect";
import { useAnnotationFrameTime } from "@/shared/annotations/editor/useAnnotationFrameTime";

interface Props {
  recording: LocalRecording; disabled: boolean; annotations: AnnotationController;
  playback: { videoRef: RefObject<HTMLVideoElement | null>; pullTime: number; offsetMs: number; seekToPull: (seconds: number, play: boolean) => void };
}

/** 视频图层只处理归一化绘制，保存、撤销和跨页草稿由应用级领域状态承担。 */
export function VideoAnnotations({ recording, playback, disabled, annotations }: Props) {
  const doc = annotations.document;
  const rect = useVideoContentRect(playback.videoRef, recording.playbackUrl);
  const frameTimeMs = useAnnotationFrameTime(playback.videoRef, recording, playback.offsetMs);
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tool, setTool] = useState<DrawingTool>("arrow");
  const [style, setStyle] = useState<AnnotationStyle>({ color: ANNOTATION_DEFAULT_COLOR, width: ANNOTATION_DEFAULT_WIDTH, text: "", durationMs: ANNOTATION_DEFAULT_DURATION_MS });
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreview] = useState<VideoAnnotation | null>(null);
  const draft = useRef<VideoAnnotation | null>(null);
  const moving = useRef<{ original: VideoAnnotation; start: AnnotationPoint; changed: boolean } | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const pointer = useRef<number | null>(null);
  const selected = doc.items.find((item) => item.id === selectedId);
  const currentMs = Math.round(playback.pullTime * 1000);
  const items = useMemo(() => visibleAnnotations(doc.items, currentMs), [doc.items, currentMs]);
  const locked = disabled || frameTimeMs === null || !doc.canEdit || doc.loading || doc.saving || !doc.loaded || !rect;
  const canDraw = !locked && expanded && visible;
  const latest = useRef({ annotations, canDraw });
  latest.current = { annotations, canDraw };

  const cancelDraft = () => {
    draft.current = null; moving.current = null; setPreview(null);
    if (pointer.current !== null && svg.current?.hasPointerCapture(pointer.current)) svg.current.releasePointerCapture(pointer.current);
    pointer.current = null;
  };
  useEffect(() => { setExpanded(false); setSelectedId(undefined); cancelDraft(); }, [annotations.key]);
  useEffect(() => { if (selectedId && !selected) setSelectedId(undefined); }, [selectedId, selected]);
  useEffect(() => {
    if (selected) setStyle({ color: selected.color, width: selected.width, text: selected.text, durationMs: selected.durationMs });
  }, [selected]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input,textarea,[contenteditable='true'],[role='combobox']")) return;
      if (event.key === "Escape") { cancelDraft(); setExpanded(false); return; }
      if (!latest.current.canDraw || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.code === "KeyZ") { event.preventDefault(); if (event.shiftKey) latest.current.annotations.redo(); else latest.current.annotations.undo(); }
      if (event.code === "KeyY") { event.preventDefault(); latest.current.annotations.redo(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  const point = (event: PointerEvent<SVGSVGElement>): AnnotationPoint => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)), y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (!canDraw || event.button !== 0) return;
    const video = playback.videoRef.current;
    const frameTime = video && !video.seeking ? annotationFrameTime(recording, video.currentTime, playback.offsetMs) : null;
    if (frameTime === null) return;
    event.preventDefault(); setSelectedId(undefined); playback.videoRef.current?.pause();
    if (tool === "select" || doc.items.length >= ANNOTATION_MAX_ITEMS) return;
    if (tool === "text" && !style.text.trim()) return;
    const start = point(event);
    const atMs = Math.round(frameTime);
    draft.current = { id: crypto.randomUUID(), kind: tool, points: tool === "text" || tool === "marker" ? [start] : [start, start], ...style, atMs };
    pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(draft.current);
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const item = draft.current;
    if (!item || !event.currentTarget.hasPointerCapture(event.pointerId) || !rect) return;
    const next = point(event);
    const translation = moving.current;
    if (translation) {
      const original = translation.original.points;
      const dx = Math.min(1 - Math.max(...original.map((value) => value.x)), Math.max(-Math.min(...original.map((value) => value.x)), next.x - translation.start.x));
      const dy = Math.min(1 - Math.max(...original.map((value) => value.y)), Math.max(-Math.min(...original.map((value) => value.y)), next.y - translation.start.y));
      if (!translation.changed && Math.hypot(dx * rect.width, dy * rect.height) < ANNOTATION_POINT_STEP_PX) return;
      translation.changed = true;
      draft.current = { ...item, points: original.map((value) => ({ x: value.x + dx, y: value.y + dy })) };
      setPreview(draft.current); return;
    }
    let points = item.points;
    if (item.kind === "pen") {
      const last = points.at(-1)!;
      if (points.length >= ANNOTATION_MAX_POINTS || Math.hypot((next.x - last.x) * rect.width, (next.y - last.y) * rect.height) < ANNOTATION_POINT_STEP_PX) return;
      points = [...points, next];
    } else if (item.kind !== "text" && item.kind !== "marker") points = [points[0], next];
    draft.current = { ...item, points }; setPreview(draft.current);
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    const item = draft.current;
    if (!item || !event.currentTarget.hasPointerCapture(event.pointerId) || !canDraw) { cancelDraft(); return; }
    if (moving.current) {
      if (moving.current.changed) annotations.edit(doc.items.map((value) => value.id === item.id ? item : value));
      setSelectedId(item.id); cancelDraft(); return;
    }
    const end = point(event);
    const points = item.kind === "pen" || item.kind === "text" || item.kind === "marker" ? item.points : [item.points[0], end];
    annotations.edit([...doc.items, { ...item, points }]);
    setSelectedId(item.id); cancelDraft();
  };
  const startMove = (item: VideoAnnotation, event: PointerEvent<SVGGElement>) => {
    if (!canDraw || event.button !== 0 || !svg.current) return;
    const video = playback.videoRef.current;
    if (!video || video.seeking || annotationFrameTime(recording, video.currentTime, playback.offsetMs) === null) return;
    event.preventDefault(); setSelectedId(item.id); playback.videoRef.current?.pause();
    const bounds = svg.current.getBoundingClientRect();
    moving.current = { original: item, start: { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }, changed: false };
    draft.current = item; pointer.current = event.pointerId; svg.current.setPointerCapture(event.pointerId); setPreview(item);
  };
  const changeStyle = (next: AnnotationStyle) => {
    setStyle(next);
    if (selected) annotations.edit(doc.items.map((item) => item.id === selected.id ? { ...item, ...next } : item));
  };
  const choose = (id: string | undefined) => {
    setSelectedId(id); setTool("select");
    const item = doc.items.find((item) => item.id === id);
    if (item) playback.seekToPull(item.atMs / 1000, false);
  };

  return <>
    {rect && visible && !disabled && frameTimeMs !== null && <svg ref={svg} aria-label="视频标注画布" data-annotation-canvas
      className="annotation-canvas" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, pointerEvents: canDraw ? "auto" : "none", touchAction: "none", cursor: canDraw ? tool === "select" ? "default" : "crosshair" : undefined }}
      viewBox={`0 0 ${rect.width} ${rect.height}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelDraft} onLostPointerCapture={cancelDraft}>
      {items.filter((item) => !preview || preview.id !== item.id).map((item) => <AnnotationShape key={item.id} item={item} width={rect.width} height={rect.height} selected={expanded && selectedId === item.id}
        selectable={canDraw && tool === "select"} onSelect={(event) => startMove(item, event)} />)}
      {preview && <AnnotationShape item={preview} width={rect.width} height={rect.height} selected={false} selectable={false} onSelect={() => {}} />}
    </svg>}
    <AnnotationToolbar document={doc} expanded={expanded} onToggle={() => { if (!expanded) playback.videoRef.current?.pause(); setExpanded(!expanded); cancelDraft(); }}
      visible={visible} onVisible={setVisible} tool={tool} onTool={(next) => { setTool(next); setSelectedId(undefined); cancelDraft(); }} style={style} onStyle={changeStyle}
      selected={selected} onSelect={choose} onUndo={annotations.undo} onRedo={annotations.redo} onClear={() => annotations.edit([])}
      onDelete={() => annotations.edit(doc.items.filter((item) => item.id !== selectedId))} onSave={() => void annotations.save()} onReload={() => void annotations.reload()}
      disabled={disabled || !rect || frameTimeMs === null} frameUnavailable={!!rect && frameTimeMs === null} />
  </>;
}
