import { useEffect, useState } from "react";
import { liveService } from "@/features/live/liveService";

const STRICT_MODE_START_DELAY_MS = 150;

/** 管理直播页生命周期内唯一的 OBS 虚拟摄像头会话。 */
export function usePersonalLiveSession(enabled: boolean) {
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDeviceLabel(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const session = await liveService.startPersonalSession();
        if (active) {
          setDeviceLabel(session.deviceLabel);
        }
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, STRICT_MODE_START_DELAY_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  return {
    deviceLabel,
    loading,
    error,
  };
}
