import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CLOUD_STATUS_POLL_MS } from "@/features/cloud/config";
import type { CloudSettings, CloudSettingsInput, CloudUploadJob } from "@/features/cloud/model";
import { changeCloudUpload, enqueueCloudUpload, getCloudSettings, getCloudUploads, setCloudSettings, verifyCloudConnection } from "@/features/cloud/service";

interface CloudContextValue {
  settings: CloudSettings | null;
  jobs: CloudUploadJob[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveSettings: (input: CloudSettingsInput) => Promise<void>;
  verify: () => Promise<void>;
  enqueue: (pullId: string, teamPullId?: string) => Promise<void>;
  retry: (jobId: string) => Promise<void>;
  pause: (jobId: string) => Promise<void>;
  cancel: (jobId: string) => Promise<void>;
}

const CloudContext = createContext<CloudContextValue | null>(null);

/** 跨页面保留显示状态，启动后的上传运行真值始终从 Rust 获取。 */
export function CloudProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<CloudSettings | null>(null);
  const [jobs, setJobs] = useState<CloudUploadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const mutations = useRef<Promise<void>>(Promise.resolve());

  const refresh = useCallback((): Promise<void> => {
    if (pendingRefresh.current) return pendingRefresh.current;
    const request = (async () => {
    try {
      const [nextSettings, nextJobs] = await Promise.all([getCloudSettings(), getCloudUploads()]);
      if (mounted.current) {
        setSettings(nextSettings);
        setJobs(nextJobs);
        setError(null);
      }
    } catch (failure) {
      if (mounted.current) setError(String(failure));
    } finally {
      if (mounted.current) setLoading(false);
    }
    })();
    pendingRefresh.current = request;
    void request.finally(() => {
      if (pendingRefresh.current === request) pendingRefresh.current = null;
    });
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), CLOUD_STATUS_POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const perform = useCallback((action: () => Promise<unknown>) => {
    const mutation = mutations.current.then(async () => {
    try {
      await action();
      // 等待变更前的查询退出，再读取新状态，避免旧轮询覆盖已保存的连接。
      if (pendingRefresh.current) await pendingRefresh.current;
      await refresh();
    } catch (failure) {
      if (mounted.current) setError(String(failure));
      throw failure;
    }
    });
    mutations.current = mutation.catch(() => undefined);
    return mutation;
  }, [refresh]);

  const value = useMemo<CloudContextValue>(() => ({
    settings, jobs, loading, error, refresh,
    saveSettings: (input) => perform(() => setCloudSettings(input)),
    verify: () => perform(verifyCloudConnection),
    enqueue: (pullId, teamPullId) => perform(() => enqueueCloudUpload(pullId, teamPullId)),
    retry: (jobId) => perform(() => changeCloudUpload("retry", jobId)),
    pause: (jobId) => perform(() => changeCloudUpload("pause", jobId)),
    cancel: (jobId) => perform(() => changeCloudUpload("cancel", jobId)),
  }), [settings, jobs, loading, error, refresh, perform]);

  return <CloudContext.Provider value={value}>{children}</CloudContext.Provider>;
}

export function useCloud() {
  const context = useContext(CloudContext);
  if (!context) throw new Error("云端状态必须在 CloudProvider 内使用");
  return context;
}
