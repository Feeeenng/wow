import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { useCloud } from "@/features/cloud/CloudProvider";
import type { LocalRecording } from "@/shared/replay/model";
import { annotationService } from "@/features/replay/annotations/service";
import { editAnnotations, emptyAnnotationDocument, redoAnnotations, undoAnnotations } from "@/shared/annotations/model";
import type { AnnotationDocument, VideoAnnotation } from "@/shared/annotations/model";

interface ContextValue {
  documents: Record<string, AnnotationDocument>;
  load: (key: string, source: "local" | "cloud", pullId: string, force?: boolean) => Promise<void>;
  save: (key: string, source: "local" | "cloud", pullId: string) => Promise<void>;
  change: (key: string, update: (document: AnnotationDocument) => AnnotationDocument) => void;
}
const Context = createContext<ContextValue | null>(null);
const empty = emptyAnnotationDocument();

/** 草稿及撤销历史在导航间保留，保存事实只来自 Rust／服务端成功返回。 */
export function AnnotationProvider({ children }: PropsWithChildren) {
  const [documents, setDocuments] = useState<Record<string, AnnotationDocument>>({});
  const current = useRef(documents);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = useCallback((key: string, update: (document: AnnotationDocument) => AnnotationDocument) => {
    if (!mounted.current) return;
    const old = current.current[key] ?? emptyAnnotationDocument();
    const next = update(old);
    if (old === next) return;
    current.current = { ...current.current, [key]: next };
    setDocuments(current.current);
  }, []);
  const load = useCallback(async (key: string, source: "local" | "cloud", pullId: string, force = false) => {
    const old = current.current[key];
    if (old?.saving || old?.loading || old?.loaded && !force) return;
    change(key, (value) => ({ ...value, loading: true, error: null }));
    try {
      const snapshot = await annotationService.load(source, pullId);
      if (!snapshot || !Array.isArray(snapshot.items)) throw new Error("标注快照响应无效");
      change(key, () => ({ ...emptyAnnotationDocument(), ...snapshot, savedItems: snapshot.items, loaded: true }));
    } catch (error) { change(key, (value) => ({ ...value, loading: false, loaded: true, error: String(error) })); }
  }, [change]);
  const save = useCallback(async (key: string, source: "local" | "cloud", pullId: string) => {
    const old = current.current[key];
    if (!old || !old.loaded || !old.canEdit || old.saving) return;
    change(key, (value) => ({ ...value, saving: true, error: null }));
    try {
      const snapshot = await annotationService.save(source, pullId, old.version, old.items);
      change(key, (value) => ({ ...value, ...snapshot, savedItems: snapshot.items, saving: false, error: null, conflict: false }));
    } catch (error) {
      const message = String(error);
      change(key, (value) => ({ ...value, saving: false, error: message,
        conflict: message.includes("ANNOTATION_CONFLICT") || message.includes("HTTP 409") }));
    }
  }, [change]);
  return <Context.Provider value={{ documents, load, save, change }}>{children}</Context.Provider>;
}

/** 文档按录像、服务及当前身份隔离；切视角不会复用其他画面的笔迹。 */
export function useVideoAnnotations(recording: LocalRecording) {
  const context = useContext(Context);
  const cloud = useCloud();
  if (!context) throw new Error("录像标注缺少应用级 Provider");
  const source = recording.sourceKind === "cloud" ? "cloud" : "local";
  const key = `${source}:${source === "cloud" ? cloud.settings?.connectionKey ?? "" : ""}:${recording.pullId}`;
  useEffect(() => { void context.load(key, source, recording.pullId); }, [context.load, key, source, recording.pullId]);
  return { key, document: context.documents[key] ?? empty,
    edit: (items: VideoAnnotation[]) => context.change(key, (value) => editAnnotations(value, items)),
    undo: () => context.change(key, undoAnnotations), redo: () => context.change(key, redoAnnotations),
    save: () => context.save(key, source, recording.pullId), reload: () => context.load(key, source, recording.pullId, true) };
}
