import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { REPLAY_SAVE_DELAY_MS } from "@/features/replay/config";
import { defaultReplayPreferences, replayPreferencesService } from "@/features/replay/preferences";
import type { ReplayPreferences } from "@/features/replay/preferences";

interface ReplayContextValue {
  preferences: ReplayPreferences;
  ready: boolean;
  persistenceError: string | null;
  update: (change: (current: ReplayPreferences) => ReplayPreferences) => void;
}

const ReplayContext = createContext<ReplayContextValue | null>(null);

/** 在应用生命周期保留回放书签，偏好写入统一 Rust 存储。 */
export function ReplayProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState(defaultReplayPreferences);
  const [ready, setReady] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<ReplayPreferences | null>(null);
  const loaded = useRef(false);
  const mounted = useRef(false);

  const flush = useCallback(() => {
    const snapshot = pending.current;
    if (!snapshot) return;
    pending.current = null;
    writes.current = writes.current.catch(() => {}).then(async () => {
      try {
        await replayPreferencesService.save(snapshot);
        if (mounted.current) setPersistenceError(null);
      } catch (error) {
        if (mounted.current) setPersistenceError(String(error));
      }
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void replayPreferencesService.load().then((value) => {
      if (active) {
        loaded.current = true;
        setPreferences({ ...defaultReplayPreferences, ...value, catalogSource: value.catalogSource === "team" ? "team" : "local" });
      }
    }).catch((error) => {
      if (active) setPersistenceError(String(error));
    }).finally(() => {
      if (active) {
        setReady(true);
      }
    });
    const save = () => flush();
    window.addEventListener("pagehide", save);
    return () => {
      active = false;
      mounted.current = false;
      window.removeEventListener("pagehide", save);
      flush();
    };
  }, [flush]);

  useEffect(() => {
    if (!ready || !loaded.current) return;
    pending.current = preferences;
    const timer = window.setTimeout(flush, REPLAY_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [preferences, ready, flush]);

  return (
    <ReplayContext.Provider value={{ preferences, ready, persistenceError, update: setPreferences }}>
      {children}
    </ReplayContext.Provider>
  );
}

/** 读取应用级回放状态，页面导航不重新建立业务偏好。 */
export function useReplayState() {
  const value = useContext(ReplayContext);
  if (!value) throw new Error("回放状态缺少应用级 Provider");
  return value;
}
