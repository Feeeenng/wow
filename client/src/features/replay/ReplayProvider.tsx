import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { message } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
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
  const writes = useRef<Promise<boolean>>(Promise.resolve(true));
  const pending = useRef<ReplayPreferences | null>(null);
  const loaded = useRef(false);
  const mounted = useRef(false);
  const closing = useRef(false), latest = useRef({ preferences, ready });
  latest.current = { preferences, ready };
  const [feedback, holder] = message.useMessage();

  const flush = useCallback(() => {
    const snapshot = pending.current;
    if (!snapshot) return writes.current;
    pending.current = null;
    writes.current = writes.current.catch(() => false).then(async () => {
      try {
        await replayPreferencesService.save(snapshot);
        if (mounted.current) setPersistenceError(null);
        return true;
      } catch (error) {
        if (mounted.current) setPersistenceError(String(error));
        return false;
      }
    });
    return writes.current;
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
    const save = () => { void flush(); };
    window.addEventListener("pagehide", save);
    return () => {
      active = false;
      mounted.current = false;
      window.removeEventListener("pagehide", save);
      void flush();
    };
  }, [flush]);

  useEffect(() => {
    if (!ready || !loaded.current || closing.current) return;
    pending.current = preferences;
    const timer = window.setTimeout(flush, REPLAY_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [preferences, ready, flush]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const currentWindow = getCurrentWindow();
    let disposed = false, registration: Promise<UnlistenFn>, releasePromise: Promise<void> | null = null;
    const release = () => {
      releasePromise ??= registration.then(async (unlisten) => { await unlisten(); });
      return releasePromise;
    };
    registration = currentWindow.onCloseRequested(async (event) => {
      // 关闭前排空防抖及在途保存；解除自身监听后再正常关闭，无需新增destroy权限。
      event.preventDefault();
      if (disposed) { await release(); await currentWindow.close(); return; }
      if (closing.current) return;
      closing.current = true;
      try {
        if (loaded.current && latest.current.ready) {
          pending.current = latest.current.preferences;
          if (!await flush()) {
            closing.current = false;
            void feedback.error("回放设置保存失败，已取消关闭。请处理错误后再次关闭。");
            return;
          }
        }
        await release(); await currentWindow.close();
      } catch (error) {
        closing.current = false;
        if (!disposed) { setPersistenceError(String(error)); void feedback.error("关闭前保存未完成，请重试。"); }
      }
    });
    void registration.catch((error) => { if (!disposed) setPersistenceError("关闭前保存监听失败：" + String(error)); });
    return () => { disposed = true; void release().catch(() => {}); };
  }, [flush, feedback]);

  const update = useCallback((change: (value: ReplayPreferences) => ReplayPreferences) => {
    if (!closing.current) setPreferences(change);
  }, []);

  return (
    <ReplayContext.Provider value={{ preferences, ready, persistenceError, update }}>
      {holder}
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
