import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording, SharedCalibration } from "@/shared/replay/model";
import { useSession } from "@/auth/SessionProvider";
import { CATALOG_PAGE_SIZE } from "@/config";
import { normalizeEntry } from "@/replay/catalog/model";
import type { CloudEntry } from "@/replay/catalog/model";
import { errorMessage } from "@/auth/api";

interface PullManifest {
  teamId: string; teamPullId: string; encounterId: number; encounterName: string; difficultyId: number;
  encounterStartUnixMs: number; encounterEndUnixMs: number; views: CloudEntry[];
}

/** 目录只读取有界元数据，选中后单独获取该场全部视角，不预加载视频。 */
export function useCatalog(team: string) {
  const { api } = useSession();
  const [rows, setRows] = useState<LocalRecording[]>([]);
  const [loading, setLoading] = useState(false), [hasMore, setHasMore] = useState(false), [error, setError] = useState<string | null>(null);
  const current = useRef({ team, api, rows }); current.current = { team, api, rows };
  const generation = useRef(0), busy = useRef(false);
  const nextOffset = useRef(0);
  const load = useCallback(async (reset: boolean) => {
    if (!api || busy.current) return;
    const request = ++generation.current; busy.current = true; setLoading(true); setError(null);
    const offset = reset ? 0 : nextOffset.current;
    try {
      const data = await api.request<CloudEntry[]>("/teams/" + team + "/recordings?offset=" + offset + "&limit=" + CATALOG_PAGE_SIZE);
      const values = data.map((item) => normalizeEntry(item, team));
      if (generation.current !== request || current.current.team !== team || current.current.api !== api) return;
      setRows((previous) => reset ? values : [...new Map([...previous, ...values].map((item) => [item.pullId, item])).values()]);
      nextOffset.current = offset + data.length;
      setHasMore(data.length === CATALOG_PAGE_SIZE);
    } catch (failure) {
      if (generation.current === request) { setError(errorMessage(failure)); if (reset) setRows([]); }
    } finally { if (generation.current === request) { busy.current = false; setLoading(false); } }
  }, [team, api]);
  useEffect(() => {
    generation.current++; busy.current = false; nextOffset.current = 0; setRows([]); setHasMore(false); void load(true);
    return () => { generation.current++; busy.current = false; };
  }, [load]);
  return { rows, loading, error, hasMore, refresh: () => load(true), more: () => load(false) };
}

/** 场次切换独立代次，较慢的旧报告不能覆盖新场。 */
export function useBattle(team: string, pull: string | null) {
  const { api } = useSession();
  const [state, setState] = useState({ key: "", views: [] as LocalRecording[], loading: false, error: null as string | null });
  const [reload, setReload] = useState({ attempt: 0, preserve: false });
  const key = team + ":" + pull;
  useEffect(() => {
    if (!api || !pull) return;
    let active = true;
    setState((old) => reload.preserve && old.key === key && old.views.length
      ? { ...old, error: null } : { key, views: [], loading: true, error: null });
    void api.request<PullManifest>("/teams/" + team + "/pulls/" + pull + "/replay").then((manifest) => {
      if (manifest.teamId !== team || manifest.teamPullId !== pull || !Array.isArray(manifest.views)) throw new Error("战斗视角格式无效。");
      const views = manifest.views.map((item) => normalizeEntry({ ...manifest, ...item }, team));
      if (active) setState({ key, views, loading: false, error: null });
    }).catch((failure) => { if (active) setState((old) => ({ key,
      views: reload.preserve && old.key === key ? old.views : [], loading: false, error: errorMessage(failure) })); });
    return () => { active = false; };
  }, [api, team, pull, key, reload]);
  const update = (id: string, snapshot: SharedCalibration) => setState((old) => old.key === key
    ? { ...old, views: old.views.map((item) => item.pullId === id && item.cloudPlaybackVersion === snapshot.playbackVersion ? { ...item, sharedCalibration: snapshot } : item) } : old);
  return { ...(state.key === key ? state : { views: [], loading: !!pull, error: null }), update,
    refresh: () => setReload((value) => ({ attempt: value.attempt + 1, preserve: false })),
    refreshMetadata: () => setReload((value) => ({ attempt: value.attempt + 1, preserve: true })) };
}
