import { useCallback, useEffect, useRef, useState } from "react";
import { WCL_REPORT_POLL_MS } from "@/shared/replay/config";
import { wclReportService } from "@/features/replay/reports/service";
import type { WclActorBinding, WclReportStatus } from "@/shared/replay/reports";

/** 只在面板打开时观察后台任务；关面板不取消服务端任务，换连接时丢弃旧响应。 */
export function useWclReport(open: boolean, pullId: string | undefined, connectionKey: string, onPublished: () => void) {
  const key = `${connectionKey}:${pullId ?? ""}`;
  const [state, setState] = useState<{ key: string; status: WclReportStatus | null; loading: boolean; error: string | null }>({ key, status: null, loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ key, open, onPublished });
  latest.current = { key, open, onPublished };
  const published = useRef<string | null>(null);
  const sequence = useRef(0);
  const [submitting, setSubmitting] = useState(false);
  const accept = useCallback((requestKey: string, status: WclReportStatus) => {
    if (latest.current.key !== requestKey || !latest.current.open) return;
    setState({ key: requestKey, status, loading: false, error: null });
    if (status.revision && published.current !== `${requestKey}:${status.revision}`) {
      published.current = `${requestKey}:${status.revision}`;
      latest.current.onPublished();
    }
  }, []);

  useEffect(() => {
    if (!open || !pullId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = ++sequence.current;
    setState((current) => ({ key, status: current.key === key ? current.status : null, loading: true, error: null }));
    const read = async () => {
      try {
        const status = await wclReportService.get(pullId);
        if (!active || sequence.current !== request) return;
        accept(key, status);
        if (status.status === "pending" || status.status === "importing") timer = setTimeout(() => void read(), WCL_REPORT_POLL_MS);
      } catch (error) {
        if (active && sequence.current === request) setState((current) => ({ ...current, loading: false, error: String(error) }));
      }
    };
    void read();
    return () => { active = false; clearTimeout(timer); sequence.current++; };
  }, [open, pullId, key, attempt, accept]);

  const start = async (request: { reportCode: string; fightId: number; actorBindings: WclActorBinding[]; refresh?: boolean }) => {
    if (!pullId || submitting) return;
    const requestKey = key;
    sequence.current++;
    setSubmitting(true);
    setState((current) => ({ ...current, error: null }));
    try {
      const status = await wclReportService.start(pullId, request);
      if (latest.current.key !== requestKey) return;
      accept(requestKey, status);
      setAttempt((value) => value + 1);
    } catch (error) {
      if (latest.current.key === requestKey) setState((current) => ({ ...current, loading: false, error: String(error) }));
    } finally { setSubmitting(false); }
  };
  return { ...(state.key === key ? state : { key, status: null, loading: open, error: null }), submitting, start, refresh: () => setAttempt((value) => value + 1) };
}
