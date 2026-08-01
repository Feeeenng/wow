import { useCallback, useEffect, useState } from "react";
import type { ObsConnectRequest, ObsStatus } from "@/features/obs/model";
import { disconnectedObsStatus } from "@/features/obs/model";
import { obsService } from "@/features/obs/obsService";

/** 管理 OBS 子窗口的连接、录制和错误状态。 */
export function useObsConnection() {
  const [status, setStatus] = useState<ObsStatus>(disconnectedObsStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (action: () => Promise<ObsStatus>) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setStatus(next);
      return next;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const refresh = useCallback(() => execute(() => obsService.status()), [execute]);
  useEffect(() => { void refresh(); }, [refresh]);

  return {
    status,
    busy,
    error,
    refresh,
    connect: (request: ObsConnectRequest) => execute(() => obsService.connect(request)),
    disconnect: () => execute(() => obsService.disconnect()),
    startRecording: () => execute(() => obsService.startRecording()),
    stopRecording: () => execute(() => obsService.stopRecording()),
  };
}
