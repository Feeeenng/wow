import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/SessionProvider";
import { ApiError, errorMessage } from "@/auth/api";
import { WCL_REPORT_POLL_MS } from "@/shared/replay/config";
import type { WclImportRequest, WclReportStatus } from "@/shared/replay/reports";

/** 只观察当前打开场次；关面板不撤销后台任务，过期请求不能改写新场次。 */
export function useWclReport(open: boolean, team: string, pull: string | null, onPublished: () => void) {
  const { api } = useSession();
  const key = team + ":" + pull;
  const [state, setState] = useState({ key, status: null as WclReportStatus | null, loading: false, error: null as string | null });
  const [attempt, setAttempt] = useState(0), [submitting, setSubmitting] = useState(false);
  const latest = useRef({ key, open, api, onPublished }); latest.current = { key, open, api, onPublished };
  const sequence = useRef(0), pending = useRef(false), published = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const accept = useCallback((requestKey: string, status: WclReportStatus) => {
    if (latest.current.key !== requestKey || !latest.current.open) return;
    setState({ key: requestKey, status, loading: false, error: null });
    if (status.revision && published.current !== requestKey + ":" + status.revision) {
      published.current = requestKey + ":" + status.revision; latest.current.onPublished();
    }
  }, []);
  useEffect(() => {
    if (!api || !open || !pull) return;
    const request = ++sequence.current; let active = true;
    setState((old) => ({ key, status: old.key === key ? old.status : null, loading: true, error: null }));
    const read = async () => {
      if (!active || sequence.current !== request) return;
      try {
        const status = await api.request<WclReportStatus>("/teams/" + team + "/pulls/" + pull + "/wcl");
        if (!active || sequence.current !== request) return;
        accept(key, status);
        if (["pending", "importing"].includes(status.status)) timer.current = setTimeout(() => void read(), WCL_REPORT_POLL_MS);
      } catch (error) {
        if (active && sequence.current === request) setState((old) => ({ ...old, loading: false, error: errorMessage(error) }));
      }
    };
    void read();
    return () => { active = false; ++sequence.current; clearTimeout(timer.current); };
  }, [api, open, team, pull, key, attempt, accept]);
  const start = async (body: WclImportRequest) => {
    if (!api || !pull || pending.current) return;
    pending.current = true; ++sequence.current; clearTimeout(timer.current); setSubmitting(true);
    setState((old) => ({ ...old, error: null }));
    try {
      const status = await api.request<WclReportStatus>("/teams/" + team + "/pulls/" + pull + "/wcl/imports", "POST", body);
      if (latest.current.key === key && latest.current.api === api) { accept(key, status); setAttempt((value) => value + 1); }
    } catch (error) {
      if (latest.current.key === key && latest.current.api === api) setState((old) => ({ ...old, loading: false, error: errorMessage(error),
        status: error instanceof ApiError && error.status === 403 && old.status ? { ...old.status, canImport: false } : old.status }));
    } finally { pending.current = false; setSubmitting(false); }
  };
  return { ...(state.key === key ? state : { key, status: null, loading: open, error: null }), submitting, start,
    refresh: () => setAttempt((value) => value + 1) };
}
