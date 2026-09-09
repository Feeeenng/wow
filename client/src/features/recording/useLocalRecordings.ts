import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalRecording } from "@/features/recording/model";
import { recordingService } from "@/features/recording/recordingService";

const REFRESH_INTERVAL_MS = 2_000;

/** 轮询本地录像索引，使刚结束的 Pull 无需重新进入页面即可出现。 */
export function useLocalRecordings() {
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [recordings, setRecordings] = useState<LocalRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (background = false) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    if (!background) {
      setRefreshing(true);
    }
    try {
      const nextRecordings = await recordingService.list();
      if (mounted.current) {
        setRecordings(nextRecordings);
        setError(null);
      }
    } catch (reason) {
      if (mounted.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    const interval = window.setInterval(() => void refresh(true), REFRESH_INTERVAL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  return { recordings, loading, refreshing, error, refresh };
}
