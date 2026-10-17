import { ANNOTATION_HISTORY_LIMIT } from "@/shared/annotations/config";
import type { LocalRecording } from "@/shared/replay/model";
import { videoToPull } from "@/shared/replay/mapping";

export type AnnotationKind = "pen" | "arrow" | "rect" | "ellipse" | "text" | "marker";
export interface AnnotationPoint { x: number; y: number; }
export interface VideoAnnotation {
  id: string;
  kind: AnnotationKind;
  points: AnnotationPoint[];
  color: string;
  width: number;
  text: string;
  atMs: number;
  durationMs: number;
}
export interface AnnotationSnapshot { version: number; items: VideoAnnotation[]; canEdit: boolean; }
export interface AnnotationDocument extends AnnotationSnapshot {
  savedItems: VideoAnnotation[];
  past: VideoAnnotation[][];
  future: VideoAnnotation[][];
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  conflict: boolean;
}

/** 编辑器只消费文档操作，不依赖桌面或网页的保存方式。 */
export interface AnnotationController {
  key: string;
  document: AnnotationDocument;
  edit: (items: VideoAnnotation[]) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
}

export const emptyAnnotationDocument = (): AnnotationDocument => {
  const items: VideoAnnotation[] = [];
  return { version: 0, items, savedItems: items, canEdit: false,
    past: [], future: [], loaded: false, loading: false, saving: false, error: null, conflict: false };
};

/** 编辑只保存快照引用，原对象保持不可变，撤销不改写录像或事件。 */
export function editAnnotations(document: AnnotationDocument, items: VideoAnnotation[]): AnnotationDocument {
  if (!document.canEdit || document.saving || items === document.items) return document;
  return { ...document, items, past: [...document.past, document.items].slice(-ANNOTATION_HISTORY_LIMIT), future: [] };
}

export function undoAnnotations(document: AnnotationDocument): AnnotationDocument {
  const items = document.past.at(-1);
  return !items || !document.canEdit || document.saving ? document : { ...document, items, past: document.past.slice(0, -1), future: [document.items, ...document.future] };
}

export function redoAnnotations(document: AnnotationDocument): AnnotationDocument {
  const items = document.future[0];
  return !items || !document.canEdit || document.saving ? document : { ...document, items, past: [...document.past, document.items], future: document.future.slice(1) };
}

/** 标注只在自身战斗时段显示；跨视角隔离由文档键承担。 */
export function visibleAnnotations(items: VideoAnnotation[], timeMs: number): VideoAnnotation[] {
  return items.filter((item) => item.atMs <= timeMs && timeMs <= item.atMs + item.durationMs);
}

/** 预滚／尾滚及未定位片段不能用被截断的游标冒充战斗起止画面。 */
export function annotationFrameTime(recording: LocalRecording, videoSeconds: number, offsetMs: number): number | null {
  if (recording.encounterEndUnixMs == null) return null;
  const duration = recording.encounterEndUnixMs - recording.encounterStartUnixMs;
  const mapped = videoToPull(recording, videoSeconds, offsetMs);
  if (mapped.kind !== "mapped") return null;
  const timeMs = mapped.seconds * 1000;
  return timeMs >= 0 && timeMs <= duration ? timeMs : null;
}

/** 按视频真实宽高计算黑边内的内容位置，坐标随窗口和全屏缩放。 */
export function videoContentRect(box: { left: number; top: number; width: number; height: number }, videoWidth: number, videoHeight: number) {
  if (videoWidth <= 0 || videoHeight <= 0 || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / videoWidth, box.height / videoHeight);
  const width = videoWidth * scale, height = videoHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}
