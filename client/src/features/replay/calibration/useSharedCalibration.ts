import { useEffect, useRef, useState } from "react";
import type { LocalRecording, SharedCalibration } from "@/shared/replay/model";
import { useCloud } from "@/features/cloud/CloudProvider";
import { useReplayCatalog } from "@/features/replay/catalog/ReplayCatalogProvider";
import { readSharedCalibration, saveSharedCalibration } from "@/features/replay/calibration/service";

/** 弹层只保留编辑草稿；授权快照写回应用级目录，迟到响应不能跨账号／视角发布。 */
export function useSharedCalibration(recording: LocalRecording, open: boolean) {
  const cloud = useCloud();
  const { applyCalibration } = useReplayCatalog();
  const key = `${cloud.settings?.connectionKey}:${recording.pullId}:${recording.cloudPlaybackVersion}`;
  const current = useRef(key); current.current = key;
  const mounted = useRef(true);
  const [snapshot, setSnapshot] = useState<SharedCalibration | null>(recording.sharedCalibration ?? null);
  const [draft, setDraft] = useState(recording.sharedCalibration?.offsetMs ?? 0);
  const [loaded, setLoaded] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const stillCurrent = () => mounted.current && current.current === key;
  const accept = (value: SharedCalibration) => {
    setSnapshot(value); setDraft(value.offsetMs); setLoaded(true); setVerified(true);
    if (value.playbackVersion !== recording.cloudPlaybackVersion) setError("录像版本已更新，请刷新录像目录后复核。");
    else { setError(null); applyCalibration(recording.pullId, value); }
  };
  const reload = async () => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null); setVerified(false);
    try { const value = await readSharedCalibration(recording.pullId); if (stillCurrent()) accept(value); }
    catch (failure) { if (stillCurrent()) { setError(String(failure)); setLoaded(true); } }
    finally { busy.current = false; if (stillCurrent()) setLoading(false); }
  };
  useEffect(() => { if (open && !loaded) void reload(); }, [open, loaded]);
  const save = async () => {
    if (busy.current || !snapshot?.canEdit || !snapshot.playbackVersion || snapshot.playbackVersion !== recording.cloudPlaybackVersion
      || !Number.isSafeInteger(draft) || draft < snapshot.minOffsetMs || draft > snapshot.maxOffsetMs) return;
    busy.current = true; setSaving(true); setError(null);
    try {
      const value = await saveSharedCalibration(recording.pullId, snapshot.version, snapshot.playbackVersion, draft);
      if (stillCurrent()) accept(value);
    } catch (failure) { if (stillCurrent()) setError(String(failure)); }
    finally { busy.current = false; if (stillCurrent()) setSaving(false); }
  };
  return { snapshot, draft, setDraft, loaded, verified, loading, saving, error, reload, save, dirty: draft !== (snapshot?.offsetMs ?? 0) };
}
