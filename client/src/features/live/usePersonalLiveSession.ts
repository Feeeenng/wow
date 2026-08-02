import { useEffect, useState } from "react";
import { liveService } from "@/features/live/liveService";
import type { PersonalLiveSession } from "@/features/live/model";

/** 在 OBS 已开播时读取 Rust 已创建的正式直播会话。 */
export function usePersonalLiveSession(enabled: boolean) {
  const [session, setSession] = useState<PersonalLiveSession | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setSession(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    const loadSession = async () => {
      setLoading(true);
      setError(null);
      try {
        const session = await liveService.currentPersonalSession();
        if (active) {
          setSession(session);
          if (!session) {
            setError("直播会话尚未就绪");
          }
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
    };

    void loadSession();
    return () => {
      active = false;
    };
  }, [enabled]);

  return {
    session,
    loading,
    error,
  };
}
