import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { REPLAY_EVENT_PAGE_SIZE } from "@/features/recording/config";
import type { LocalTimelineEvent } from "@/shared/replay/model";
import { readEventSnapshot } from "@/shared/replay/events";
import type { ReplayEventPage, ReplayEventSnapshot } from "@/shared/replay/events";

const emptySnapshot = (): ReplayEventSnapshot => ({ events: [], cursor: null, revision: null });

/** 目录版本变化时仅续读新增事件，选场／离页后忽略旧请求，完整分页前不展示误导性空筛选。 */
export function useReplayEvents(pullId: string | undefined, revision: string | undefined, fallback: LocalTimelineEvent[], source: "local" | "cloud" = "local") {
  const key = `${source}:${pullId ?? ""}`;
  const current = useRef<{ key: string; snapshot: ReplayEventSnapshot } | null>(null);
  const [state, setState] = useState({ key, events: fallback, loading: false, loaded: 0, total: 0, error: null as string | null });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    // 无摘要版本仅用于原有 UI fixture；真实 Tauri 摘要始终提供版本。
    if (!pullId || !revision) return;
    let active = true;
    const initial = current.current?.key === key ? current.current.snapshot : emptySnapshot();
    setState({ key, events: initial.events, loading: true, loaded: initial.events.length, total: initial.events.length, error: null });
    void readEventSnapshot(initial, (cursor) => invoke<ReplayEventPage>(source === "cloud" ? "list_cloud_replay_events" : "list_replay_events", {
      pullId, cursor, limit: REPLAY_EVENT_PAGE_SIZE,
    }), () => active, (loaded, total) => {
      if (active) setState((value) => ({ ...value, loaded, total }));
    }).then((snapshot) => {
      if (!active || !snapshot) return;
      current.current = { key, snapshot };
      setState({ key, events: snapshot.events, loading: false, loaded: snapshot.events.length, total: snapshot.events.length, error: null });
    }).catch((error: unknown) => {
      if (active) setState((value) => ({ ...value, loading: false, error: String(error) }));
    });
    return () => { active = false; };
  }, [pullId, revision, source, key, attempt]);

  if (!pullId || !revision) return { events: fallback, loading: false, loaded: fallback.length, total: fallback.length, error: null, refresh };
  if (state.key !== key) return { events: [], loading: true, loaded: 0, total: 0, error: null, refresh };
  return { ...state, refresh };
}
