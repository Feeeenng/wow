import { useEffect, useRef, useState } from "react";
import { Alert, Button, InputNumber, Popconfirm, Popover } from "antd";
import type { LocalRecording, SharedCalibration } from "@/shared/replay/model";
import { personalOffset, personalOffsetStale, sharedOffset } from "@/shared/replay/calibration";
import type { usePlayback } from "@/replay/playback/usePlayback";
import { useSession } from "@/auth/SessionProvider";
import { OFFSET_STEP_MS } from "@/config";
import { errorMessage } from "@/auth/api";

/** 本机值只保留当前会话，团队值按版本显式保存，冲突保持草稿。 */
export function CalibrationPanel({ view, team, playback, onUpdate }: { view: LocalRecording; team: string; playback: ReturnType<typeof usePlayback>; onUpdate: (id: string, snapshot: SharedCalibration) => void }) {
  const { api } = useSession(); const mounted = useRef(true);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [verified, setVerified] = useState(false);
  const [snapshot, setSnapshot] = useState<SharedCalibration | null>(view.sharedCalibration ?? null);
  const [draft, setDraft] = useState(view.sharedCalibration?.offsetMs ?? 0), [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const route = "/teams/" + team + "/recordings/" + view.pullId + "/calibration";
  const accept = (value: SharedCalibration) => {
    setSnapshot(value); setDraft(value.offsetMs); setVerified(true);
    if (value.playbackVersion === view.cloudPlaybackVersion) { onUpdate(view.pullId, value); setError(null); }
    else setError("录像版本已变化，请刷新当前战斗后复核。");
  };
  const read = async () => {
    if (!api || busy) return; setBusy(true); setError(null); setVerified(false);
    try { const result = await api.request<SharedCalibration>(route); if (mounted.current) accept(result); }
    catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const save = async () => {
    if (!api || busy || !verified || !snapshot?.canEdit || snapshot.playbackVersion !== view.cloudPlaybackVersion || !Number.isSafeInteger(draft)) return;
    setBusy(true); setError(null);
    try {
      const result = await api.request<SharedCalibration>(route, "PUT", { expectedVersion: snapshot.version, playbackVersion: snapshot.playbackVersion, offsetMs: draft });
      if (mounted.current) accept(result);
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const dirty = draft !== (snapshot?.offsetMs ?? 0), stale = personalOffsetStale(view, playback.preferences);
  return <Popover title="调整画面对齐" trigger="click" open={open} onOpenChange={(next) => { setOpen(next); if (next) { playback.videoRef.current?.pause(); if (!verified) void read(); } }} content={
    <div className="calibration-panel">
      <p className="muted">正值定位到更晚的画面，负值定位到更早的画面。</p>
      <strong>本机个人微调</strong>
      {stale && <Alert type="warning" showIcon message="原本机偏移尚未绑定当前录像，已暂停应用。"
        action={<Button size="small" onClick={() => playback.personal(playback.preferences.offsetsMs[view.pullId] ?? 0)}>复核并应用</Button>} />}
      <div className="form-row"><InputNumber aria-label="本机对齐偏移" value={personalOffset(view, playback.preferences)} step={OFFSET_STEP_MS} precision={0} suffix="毫秒"
        onChange={(value) => playback.personal(value ?? 0)} /><Button size="small" onClick={() => playback.personal(0)}>重置</Button></div>
      <span>当前生效：{playback.offset} 毫秒（团队 {sharedOffset(view)} ＋ 本机 {personalOffset(view, playback.preferences)}）</span>
      <hr /><strong>团队共享对齐</strong><p className="muted">团队成员重新读取后应用，个人微调仍会叠加。</p>
      {snapshot?.stale && <Alert type="warning" showIcon message="录像已换版，旧团队偏移未应用，请复核后保存。" />}
      {error && <Alert type="error" showIcon message={error} />}
      {snapshot && <InputNumber aria-label="团队对齐偏移" value={draft} min={snapshot.minOffsetMs} max={snapshot.maxOffsetMs} step={OFFSET_STEP_MS} precision={0} suffix="毫秒"
        disabled={busy || !verified || !snapshot.canEdit} onChange={(value) => { if (Number.isSafeInteger(value)) setDraft(value!); }} />}
      {snapshot && !snapshot.canEdit && <span className="muted">当前账号只读；上传者、团长或分析员可以保存。</span>}
      <div className="form-row">
        <Button size="small" type="primary" aria-label="保存团队对齐" loading={busy} disabled={!verified || !snapshot?.canEdit} onClick={() => void save()}>保存团队对齐</Button>
        <Popconfirm title="读取最新值将替换未保存草稿" disabled={!dirty} onConfirm={() => void read()}>
          <Button size="small" disabled={busy} onClick={() => { if (!dirty) void read(); }}>读取最新</Button>
        </Popconfirm>
      </div>
    </div>
  }><Button size="small" disabled={view.state !== "ready" || !!view.mapping?.clockDiscontinuous}>对齐微调</Button></Popover>;
}
