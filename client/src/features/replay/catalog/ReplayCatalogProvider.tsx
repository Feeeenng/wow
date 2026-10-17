import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { useCloud } from "@/features/cloud/CloudProvider";
import type { LocalRecording, SharedCalibration } from "@/shared/replay/model";
import { useLocalRecordings } from "@/features/recording/useLocalRecordings";
import { CLOUD_REPLAY_PAGE_SIZE } from "@/features/replay/config";
import { useReplayState } from "@/features/replay/ReplayProvider";
import { readCloudReplayPage } from "@/features/replay/catalog/service";

type Source = "local" | "team";
interface TeamCatalog { key: string; records: LocalRecording[]; nextOffset: number; hasMore: boolean; loaded: boolean; fetching: boolean; error: string | null; }
const emptyTeam = (key: string): TeamCatalog => ({ key, records: [], nextOffset: 0, hasMore: false, loaded: false, fetching: false, error: null });
interface Catalog {
  source: Source; setSource: (source: Source) => void;
  recordings: LocalRecording[]; loading: boolean; refreshing: boolean;
  error: string | null; blockedReason: string | null; hasMore: boolean;
  refresh: () => Promise<void>; loadMore: () => Promise<void>; activate: () => () => void;
  applyCalibration: (pullId: string, snapshot: SharedCalibration) => void;
}
const Context = createContext<Catalog | null>(null);

/** 应用级缓存本地及当前授权团队目录；团队仅按用户进入、刷新和分页动作请求元数据。 */
export function ReplayCatalogProvider({ children }: PropsWithChildren) {
  const local = useLocalRecordings();
  const cloud = useCloud();
  const { preferences, update } = useReplayState();
  const source = preferences.catalogSource;
  const settings = cloud.settings;
  const authorized = !!settings?.teamId && !!settings.identity?.teams.some((team) => team.teamId === settings.teamId);
  const waitingSettings = cloud.loading && !settings;
  const blockedReason = !settings?.endpoint ? "请先在设置的上传与存储配置团队服务器。"
    : !settings.hasToken ? "请先保存访问令牌并验证服务器连接。"
      : !settings.identity ? "请先验证账号身份，再读取团队录像。"
        : !authorized ? "请先选择账号已授权的团队。" : null;
  const key = `${settings?.connectionKey ?? ""}:${settings?.endpoint ?? ""}:${settings?.teamId ?? ""}:${settings?.identity?.userId ?? ""}:${authorized}`;
  const [active, setActive] = useState(false);
  const [team, setTeam] = useState(() => emptyTeam(key));
  const latest = useRef({ key, blockedReason, team });
  latest.current = { key, blockedReason, team };
  const generation = useRef(0);
  const inFlight = useRef<number | null>(null);
  const mounted = useRef(false);
  const selections = useRef<{ local: string | null; team: string | null }>({ local: null, team: null });

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { selections.current[source] = preferences.selectedPullId; }, [source, preferences.selectedPullId]);
  useEffect(() => { generation.current++; inFlight.current = null; setTeam(emptyTeam(key)); }, [key]);
  const activate = useCallback(() => { setActive(true); return () => setActive(false); }, []);
  const setSource = useCallback((next: Source) => update((value) => ({ ...value, catalogSource: next, selectedPullId: selections.current[next] })), [update]);
  const load = useCallback(async (reset: boolean) => {
    const current = latest.current;
    if (current.blockedReason || inFlight.current !== null) return;
    const request = ++generation.current;
    inFlight.current = request;
    const offset = reset || current.team.key !== current.key ? 0 : current.team.nextOffset;
    setTeam((value) => ({ ...(value.key === current.key ? value : emptyTeam(current.key)), fetching: true, error: null }));
    try {
      const response = await readCloudReplayPage(offset);
      if (!mounted.current || generation.current !== request || latest.current.key !== current.key) return;
      setTeam((previous) => {
        const records = new Map((offset === 0 ? [] : previous.records).map((recording) => [recording.pullId, recording]));
        for (const recording of response) records.set(recording.pullId, recording);
        return { key: current.key, records: [...records.values()], nextOffset: offset + response.length, hasMore: response.length === CLOUD_REPLAY_PAGE_SIZE, loaded: true, fetching: false, error: null };
      });
    } catch (failure) {
      if (mounted.current && generation.current === request) setTeam({ ...emptyTeam(current.key), loaded: true, error: String(failure) });
    } finally { if (inFlight.current === request) inFlight.current = null; }
  }, []);
  useEffect(() => {
    if (active && source === "team" && !waitingSettings && !blockedReason && (team.key !== key || !team.loaded)) void load(true);
  }, [active, source, key, waitingSettings, blockedReason, team.key, team.loaded, load]);
  const currentTeam = team.key === key ? team : emptyTeam(key);
  const applyCalibration = useCallback((pullId: string, snapshot: SharedCalibration) => {
    setTeam((value) => value.key !== key ? value : { ...value, records: value.records.map((recording) =>
      recording.pullId === pullId && recording.cloudPlaybackVersion === snapshot.playbackVersion ? { ...recording, sharedCalibration: snapshot } : recording) });
  }, [key]);
  const value: Catalog = source === "local" ? { source, setSource, ...local, blockedReason: null, hasMore: false, loadMore: () => load(false), activate, applyCalibration }
    : { source, setSource, recordings: blockedReason ? [] : currentTeam.records, loading: waitingSettings || !blockedReason && !currentTeam.loaded, refreshing: currentTeam.fetching,
      error: currentTeam.error, blockedReason: waitingSettings ? null : blockedReason, hasMore: currentTeam.hasMore, refresh: () => load(true), loadMore: () => load(false), activate, applyCalibration };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** 页面只订阅既有目录，离页后保留已加载分页，禁止循环拉取团队全部历史。 */
export function useReplayCatalog() {
  const context = useContext(Context);
  if (!context) throw new Error("回放目录缺少应用级 Provider");
  useEffect(() => context.activate(), [context.activate]);
  return context;
}
