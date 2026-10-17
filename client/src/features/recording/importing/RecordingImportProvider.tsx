import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import { recordingImportService } from "@/features/recording/importing/service";
import { emptyImportPreferences, emptyImportProgress, isImportRunning, RECORDING_IMPORT_POLL_MS } from "@/features/recording/importing/model";
import type { RecordingImportPreferences, RecordingImportProgress } from "@/features/recording/importing/model";

interface ImportContext {
  preferences: RecordingImportPreferences;
  progress: RecordingImportProgress;
  ready: boolean;
  submitting: boolean;
  error: string | null;
  refresh: () => void;
  start: (preferences: RecordingImportPreferences) => Promise<boolean>;
  cancel: () => Promise<void>;
}

const Context = createContext<ImportContext | null>(null);

/** 应用级持有导入查询与操作，任务继续运行时切页不会创建第二个导入状态。 */
export function RecordingImportProvider({ children }: PropsWithChildren) {
  const [preferences, setPreferences] = useState(emptyImportPreferences);
  const [progress, setProgress] = useState(emptyImportProgress);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    void Promise.all([recordingImportService.preferences(), recordingImportService.progress()]).then(([saved, current]) => {
      if (active) { setPreferences(saved); setProgress(current); setError(null); }
    }).catch((failure: unknown) => { if (active) setError(String(failure)); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; mounted.current = false; };
  }, [attempt]);

  useEffect(() => {
    if (!isImportRunning(progress)) return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await recordingImportService.progress();
        if (active) { setProgress(next); setError(null); }
      } catch (failure) { if (active) setError(String(failure)); }
      if (active) timer = window.setTimeout(poll, RECORDING_IMPORT_POLL_MS);
    };
    timer = window.setTimeout(poll, RECORDING_IMPORT_POLL_MS);
    return () => { active = false; window.clearTimeout(timer); };
  }, [progress.status]);

  const start = async (selected: RecordingImportPreferences) => {
    if (inFlight.current || isImportRunning(progress)) return false;
    inFlight.current = true; setSubmitting(true); setError(null);
    try {
      const current = await recordingImportService.start(selected);
      if (mounted.current) { setPreferences(selected); setProgress(current); }
      return true;
    } catch (failure) { if (mounted.current) setError(String(failure)); return false; }
    finally { inFlight.current = false; if (mounted.current) setSubmitting(false); }
  };
  const cancel = async () => {
    if (!progress.taskId || submitting) return;
    setSubmitting(true); setError(null);
    try { await recordingImportService.cancel(progress.taskId); setProgress(await recordingImportService.progress()); }
    catch (failure) { setError(String(failure)); }
    finally { setSubmitting(false); }
  };

  return <Context.Provider value={{ preferences, progress, ready, submitting, error, refresh, start, cancel }}>{children}</Context.Provider>;
}

/** 读取原生导入任务，不从持久化偏好恢复“正在导入”等瞬时状态。 */
export function useRecordingImport() {
  const context = useContext(Context);
  if (!context) throw new Error("录像导入缺少应用级 Provider");
  return context;
}
