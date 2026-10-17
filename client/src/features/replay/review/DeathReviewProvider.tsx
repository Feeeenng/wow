import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import type { DeathReview, DeathReviewPage } from "@/shared/review/model";
import { DEATH_REVIEW_PAGE_SIZE, DEATH_REVIEW_CACHE_SIZE } from "@/shared/review/config";
import { readDeathReview } from "@/features/replay/review/reading";

interface Selection { pullId: string; battleKey: string | null; eventId: string; choices: LocalTimelineEvent[]; }
interface Document { data: DeathReview | null; loading: boolean; error: string | null; }
interface State { selection: Selection | null; open: boolean; documents: Record<string, Document>; }
interface Value extends State {
  show: (selection: Selection) => void; close: () => void; reload: () => void; selectEvent: (eventId: string) => void;
}
const Context = createContext<Value | null>(null);
const keyOf = (selection: Selection) => selection.pullId + ":" + selection.eventId;

/** 当前进程的死亡快照跨页面保留，只有最近三份；不持久化运行中请求。 */
export function DeathReviewProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<State>({ selection: null, open: false, documents: {} });
  const current = useRef(state), alive = useRef(true), requests = useRef(new Map<string, number>()), serial = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; requests.current.clear(); }; }, []);
  const change = useCallback((edit: (value: State) => State) => {
    if (!alive.current) return;
    current.current = edit(current.current); setState(current.current);
  }, []);
  const load = useCallback(async (selection: Selection, force = false) => {
    const key = keyOf(selection), previous = current.current.documents[key];
    if (previous?.loading || previous?.data && !force) return;
    const request = ++serial.current; requests.current.set(key, request);
    const active = () => alive.current && requests.current.get(key) === request;
    change((value) => {
      const documents = { ...value.documents }; delete documents[key];
      documents[key] = { data: null, loading: true, error: null };
      while (Object.keys(documents).length > DEATH_REVIEW_CACHE_SIZE) {
        const oldest = Object.keys(documents)[0]; delete documents[oldest]; requests.current.delete(oldest);
      }
      return { ...value, documents };
    });
    try {
      const data = await readDeathReview(selection.eventId, (cursor) => invoke<DeathReviewPage>("get_local_death_review",
        { pullId: selection.pullId, eventId: selection.eventId, cursor, limit: DEATH_REVIEW_PAGE_SIZE }), active,
      (data) => change((value) => ({ ...value, documents: { ...value.documents, [key]: { data, loading: true, error: null } } })));
      if (active() && data) change((value) => ({ ...value, documents: { ...value.documents, [key]: { data, loading: false, error: null } } }));
    } catch (error) {
      if (active()) change((value) => ({ ...value, documents: { ...value.documents, [key]: { data: value.documents[key]?.data ?? null, loading: false, error: String(error) } } }));
    }
  }, [change]);
  const show = useCallback((selection: Selection) => {
    change((value) => ({ ...value, selection, open: true })); void load(selection);
  }, [change, load]);
  return <Context.Provider value={{ ...state, show, close: () => change((value) => ({ ...value, open: false })),
    reload: () => { if (current.current.selection) void load(current.current.selection, true); },
    selectEvent: (eventId) => { const selection = current.current.selection; if (selection?.choices.some((event) => event.eventId === eventId)) show({ ...selection, eventId }); } }}>{children}</Context.Provider>;
}

/** 页面只订阅应用级快照，不在导航卸载后重新创建同一解析任务。 */
export function useDeathReview() {
  const context = useContext(Context);
  if (!context) throw new Error("死亡复盘缺少应用级状态。");
  return { ...context, document: context.selection ? context.documents[keyOf(context.selection)] ?? null : null };
}
