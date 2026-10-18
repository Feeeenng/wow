import { useCallback, useEffect, useRef, useState } from "react";
import { recordingManagement, type ManagedRecording } from "@/features/recording/management";

/** 管理抽屉只持有查询与操作状态，收藏及文件变更都以后端成功结果为准。 */
export function useRecordingLibrary(open: boolean, onChanged: () => void | Promise<void>) {
  const [recordings, setRecordings] = useState<ManagedRecording[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await recordingManagement.list();
      if (request === generation.current) setRecordings(result);
    } catch (reason) {
      if (request === generation.current) setError(String(reason));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
    return () => { generation.current += 1; };
  }, [open, refresh]);

  const act = async (pullId: string, action: () => Promise<void>, changed = false) => {
    setBusyId(pullId);
    setError(null);
    try {
      await action();
      if (changed) {
        await onChanged();
        await refresh();
      }
    } catch (reason) {
      setError(String(reason));
      // 后端可能已经移除索引，但清理暂存媒体失败；必须重新读取真实状态。
      if (changed) {
        try { await onChanged(); } catch { /* 保留原操作错误，页面刷新失败不覆盖原因。 */ }
        try { setRecordings(await recordingManagement.list()); } catch { /* 保留原错误供重试。 */ }
      }
    } finally {
      setBusyId(null);
    }
  };

  return { recordings, loading, busyId, error, refresh, act };
}
