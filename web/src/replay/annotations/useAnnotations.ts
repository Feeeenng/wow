import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, errorMessage } from "@/auth/api";
import { useSession } from "@/auth/SessionProvider";
import { editAnnotations, emptyAnnotationDocument, redoAnnotations, undoAnnotations } from "@/shared/annotations/model";
import type { AnnotationController, AnnotationDocument, AnnotationSnapshot, VideoAnnotation } from "@/shared/annotations/model";

const empty = emptyAnnotationDocument();

/** 草稿只存在当前账号工作台内存，按团队和录像隔离；保存使用服务端CAS版本。 */
export function useAnnotations(team: string, recording: string | null): AnnotationController {
  const { api } = useSession();
  const [documents, setDocuments] = useState<Record<string, AnnotationDocument>>({});
  const current = useRef(documents), alive = useRef(false);
  const key = team + ":" + recording;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const change = useCallback((id: string, update: (value: AnnotationDocument) => AnnotationDocument) => {
    if (!alive.current) return;
    const old = current.current[id] ?? emptyAnnotationDocument(), next = update(old);
    if (old === next) return;
    current.current = { ...current.current, [id]: next }; setDocuments(current.current);
  }, []);
  const load = useCallback(async (force = false) => {
    if (!api || !recording) return;
    const old = current.current[key];
    if (old?.saving || old?.loading || old?.loaded && !force) return;
    change(key, (value) => ({ ...value, loading: true, error: null }));
    try {
      const snapshot = await api.request<AnnotationSnapshot>("/teams/" + team + "/recordings/" + recording + "/annotations");
      change(key, () => ({ ...emptyAnnotationDocument(), ...snapshot, savedItems: snapshot.items, loaded: true }));
    } catch (error) {
      change(key, (value) => ({ ...value, loading: false, error: errorMessage(error),
        canEdit: error instanceof ApiError && [403, 404].includes(error.status) ? false : value.canEdit }));
    }
  }, [api, team, recording, key, change]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    const old = current.current[key];
    if (!api || !recording || !old?.loaded || !old.canEdit || old.loading || old.saving || old.items === old.savedItems) return;
    change(key, (value) => ({ ...value, saving: true, error: null }));
    try {
      const snapshot = await api.request<AnnotationSnapshot>("/teams/" + team + "/recordings/" + recording + "/annotations", "PUT",
        { expectedVersion: old.version, items: old.items });
      change(key, (value) => ({ ...value, ...snapshot, savedItems: snapshot.items, saving: false, error: null, conflict: false }));
    } catch (error) {
      change(key, (value) => ({ ...value, saving: false, error: errorMessage(error), conflict: error instanceof ApiError && error.status === 409,
        canEdit: error instanceof ApiError && [403, 404].includes(error.status) ? false : value.canEdit }));
    }
  };
  return { key, document: documents[key] ?? empty,
    edit: (items: VideoAnnotation[]) => change(key, (value) => editAnnotations(value, items)),
    undo: () => change(key, undoAnnotations), redo: () => change(key, redoAnnotations), save, reload: () => load(true) };
}
