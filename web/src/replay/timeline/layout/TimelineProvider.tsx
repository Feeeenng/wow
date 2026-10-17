import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { ApiError, errorMessage } from "@/auth/api";
import { useSession } from "@/auth/SessionProvider";
import type { TimelineLayout } from "@/shared/replay/tracks";
import { defaultTimelineLayout } from "@/shared/replay/tracks";

interface Snapshot { version: number; document: TimelineLayout; }
interface Document {
  layout: TimelineLayout; saved: TimelineLayout; version: number; loaded: boolean;
  loading: boolean; saving: boolean; conflict: boolean; error: string | null;
}
interface Value {
  documents: Record<string, Document>;
  update: (team: string, change: (value: TimelineLayout) => TimelineLayout) => void;
  load: (team: string, force?: boolean) => Promise<void>;
  save: (team: string) => Promise<void>;
}
const Context = createContext<Value | null>(null);
const newDocument = (): Document => {
  const layout = defaultTimelineLayout();
  return { layout, saved: layout, version: 0, loaded: false, loading: false, saving: false, conflict: false, error: null };
};
const empty = newDocument();
const dirty = (value: Document) => JSON.stringify(value.layout) !== JSON.stringify(value.saved);

/** 账号级文档按团队隔离；只有显式保存成功才更新已保存版本，退出整体销毁。 */
export function TimelineProvider({ children }: PropsWithChildren) {
  const { api } = useSession();
  const [documents, setDocuments] = useState<Record<string, Document>>({});
  const current = useRef(documents), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const change = useCallback((team: string, edit: (value: Document) => Document) => {
    if (!alive.current) return;
    current.current = { ...current.current, [team]: edit(current.current[team] ?? newDocument()) };
    setDocuments(current.current);
  }, []);
  const load = useCallback(async (team: string, force = false) => {
    if (!api || !alive.current) return;
    const before = current.current[team] ?? empty;
    if (before.loading || before.saving || before.loaded && !force) return;
    const preserveDraft = !force && dirty(before);
    change(team, (value) => ({ ...value, loading: true, error: null }));
    // 初次读取期间发生编辑时保留草稿；显式重新读取由界面确认后替换。
    const initial = current.current[team].layout;
    try {
      const snapshot = await api.request<Snapshot>("/teams/" + team + "/preferences/replay");
      change(team, (value) => ({ ...value, layout: (force || !preserveDraft) && value.layout === initial ? snapshot.document : value.layout,
        saved: snapshot.document, version: snapshot.version, loaded: true, loading: false, conflict: false, error: null }));
    } catch (error) {
      change(team, (value) => ({ ...value, loading: false, error: errorMessage(error) }));
    }
  }, [api, change]);
  const save = useCallback(async (team: string) => {
    const before = current.current[team];
    if (!api || !before?.loaded || before.loading || before.saving || before.conflict || !dirty(before)) return;
    change(team, (value) => ({ ...value, saving: true, error: null }));
    try {
      const snapshot = await api.request<Snapshot>("/teams/" + team + "/preferences/replay", "PUT",
        { expectedVersion: before.version, document: before.layout });
      // 保存途中允许继续编辑，新草稿不能被较早请求的回包抹掉。
      change(team, (value) => ({ ...value, saved: snapshot.document, version: snapshot.version,
        layout: value.layout === before.layout ? snapshot.document : value.layout, saving: false, error: null, conflict: false }));
    } catch (error) {
      change(team, (value) => ({ ...value, saving: false, error: errorMessage(error), conflict: error instanceof ApiError && error.status === 409 }));
    }
  }, [api, change]);
  const update = useCallback((team: string, edit: (value: TimelineLayout) => TimelineLayout) => {
    change(team, (value) => ({ ...value, layout: edit(value.layout) }));
  }, [change]);
  return <Context.Provider value={{ documents, update, load, save }}>{children}</Context.Provider>;
}

/** 多个时间轴消费者共享同一在途读取，不因切页重新创建业务状态。 */
export function useTimelineLayout(team: string) {
  const context = useContext(Context);
  if (!context) throw new Error("缺少个人时间轴状态。");
  const { load } = context;
  useEffect(() => { void load(team); }, [team, load]);
  const document = context.documents[team] ?? empty;
  return { layout: document.layout, document, dirty: dirty(document),
    update: (edit: (value: TimelineLayout) => TimelineLayout) => context.update(team, edit),
    save: () => context.save(team), reload: () => load(team, true) };
}
