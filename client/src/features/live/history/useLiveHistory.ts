import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HISTORY_REFRESH_MS } from "@/features/live/history/config";
import { historyRanges } from "@/features/live/history/mapping";
import type { LiveHistoryManifest } from "@/features/live/history/model";

/** 历史真值只来自当前会话的 Rust 清单；切会话立即隔离旧窗口。 */
export function useLiveHistory(sessionId: string | null) {
  const [manifest, setManifest] = useState<LiveHistoryManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: number;
    setManifest(null); setError(null);
    if (!sessionId) return;
    const refresh = async () => {
      try {
        const next = await invoke<LiveHistoryManifest>("get_live_replay_manifest", { sessionId });
        if (active) { setManifest(next); setError(null); }
      } catch (failure) { if (active) setError(String(failure)); }
      finally { if (active) timer = window.setTimeout(() => void refresh(), HISTORY_REFRESH_MS); }
    };
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [sessionId]);
  const currentManifest = manifest?.sessionId === sessionId ? manifest : null;
  return { manifest: currentManifest, ranges: currentManifest ? historyRanges(currentManifest) : [], error };
}
