import { useEffect, useRef, useState } from "react";
import type { LocalRecording, LocalTimelineEvent } from "@/shared/replay/model";
import { readEventSnapshot, eventLabels } from "@/shared/replay/events";
import type { ReplayEventSnapshot, ReplayEventPage } from "@/shared/replay/events";
import { useSession } from "@/auth/SessionProvider";
import { EVENT_PAGE_SIZE, EVENT_CACHE_SIZE } from "@/config";
import { errorMessage } from "@/auth/api";

/** 完整分页前只显示加载进度，失败保留已发布旧快照，最多缓存三场。 */
export function useEvents(team: string, view: LocalRecording | null) {
  const { api } = useSession();
  const cache = useRef(new Map<string, ReplayEventSnapshot>());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ id: "", events: [] as LocalTimelineEvent[], loading: false, loaded: 0, total: 0, error: null as string | null });
  useEffect(() => {
    if (!api || !view?.timelineRevision) return;
    const id = view.pullId; let active = true;
    const initial = cache.current.get(id) ?? { events: [], cursor: null, revision: null };
    setState({ id, events: initial.events, loading: true, loaded: initial.events.length, total: view.timelineEventCount ?? 0, error: null });
    void readEventSnapshot(initial, async (cursor) => {
      const query = new URLSearchParams({ limit: String(EVENT_PAGE_SIZE) }); if (cursor) query.set("cursor", cursor);
      const page = await api.request<ReplayEventPage>("/teams/" + team + "/recordings/" + id + "/events?" + query);
      if (!Array.isArray(page.events) || !Number.isSafeInteger(page.total) || page.total < page.events.length
        || typeof page.nextCursor !== "string" || typeof page.revision !== "string"
        || page.events.some((event) => !Number.isSafeInteger(event.pullTimeMs) || !Object.hasOwn(eventLabels, event.kind))) throw new Error("标准事件分页格式无效。");
      return page;
    }, () => active, (loaded, total) => { if (active) setState((old) => ({ ...old, loaded, total })); }).then((snapshot) => {
      if (!active || !snapshot) return;
      cache.current.delete(id); cache.current.set(id, snapshot);
      while (cache.current.size > EVENT_CACHE_SIZE) cache.current.delete(cache.current.keys().next().value!);
      setState({ id, events: snapshot.events, loading: false, loaded: snapshot.events.length, total: snapshot.events.length, error: null });
    }).catch((failure) => { if (active) setState((old) => ({ ...old, loading: false, error: errorMessage(failure) })); });
    return () => { active = false; };
  }, [api, team, view?.pullId, view?.timelineRevision, attempt]);
  return { ...(state.id === view?.pullId && view?.timelineRevision ? state : { events: [], loading: !!view?.timelineRevision, loaded: 0, total: view?.timelineEventCount ?? 0, error: null }),
    waiting: !view?.timelineRevision, refresh: () => setAttempt((value) => value + 1) };
}
