import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording } from "@/shared/replay/model";
import { CLOUD_REPLAY_PAGE_SIZE } from "@/features/replay/config";
import { readCloudReplayPage } from "@/features/replay/catalog/service";

/** 仅在上传对话框打开时读取有界目录，关闭或切连接后忽略迟到的目标列表。 */
export function useUploadTargets(open: boolean, pullId: string, connectionScope: string) {
  const [state, setState] = useState({ records: [] as LocalRecording[], offset: 0, hasMore: false, loading: false, error: null as string | null });
  const current = useRef(state);
  current.current = state;
  const generation = useRef(0);
  const pending = useRef(false);
  const load = useCallback(async (reset: boolean) => {
    if (pending.current) return;
    pending.current = true;
    const version = generation.current;
    const offset = reset ? 0 : current.current.offset;
    setState((value) => ({ ...value, loading: true, error: null }));
    try {
      const records = await readCloudReplayPage(offset);
      if (generation.current === version) setState((value) => ({ records: reset ? records : [...value.records, ...records], offset: offset + records.length, hasMore: records.length === CLOUD_REPLAY_PAGE_SIZE, loading: false, error: null }));
    } catch (failure) { if (generation.current === version) setState((value) => ({ ...value, loading: false, error: String(failure) })); }
    finally { if (generation.current === version) pending.current = false; }
  }, []);
  useEffect(() => {
    generation.current++; pending.current = false;
    setState({ records: [], offset: 0, hasMore: false, loading: false, error: null });
    if (open) void load(true);
    return () => { generation.current++; pending.current = false; };
  }, [open, pullId, connectionScope, load]);
  return { ...state, refresh: () => load(true), loadMore: () => load(false) };
}
