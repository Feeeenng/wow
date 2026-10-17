import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Modal, Radio, Select, Spin } from "antd";
import type { LocalRecording } from "@/shared/replay/model";
import { formatRecordingTime } from "@/pages/replay/model";
import { uploadTargets } from "@/pages/replay/uploading/targets";
import { useUploadTargets } from "@/pages/replay/uploading/useUploadTargets";

interface Props {
  open: boolean; recording: LocalRecording; connectionScope: string; busy: boolean;
  blockedReason: string | null; onCancel: () => void; onConfirm: (teamPullId?: string) => Promise<void>;
}

/** 首次上传由用户明确新建或加入既有战斗，绝不按相近时间猜测目标。 */
export function UploadTargetDialog({ open, recording, connectionScope, busy, blockedReason, onCancel, onConfirm }: Props) {
  const [mode, setMode] = useState<"new" | "existing" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalog = useUploadTargets(open, recording.pullId, connectionScope);
  const targets = useMemo(() => uploadTargets(catalog.records, recording), [catalog.records, recording]);
  useEffect(() => { setMode(null); setSelectedId(null); setError(null); }, [open, recording.pullId, connectionScope]);
  const submit = async () => {
    if (!open || busy || blockedReason || mode === null || mode === "existing" && !targets.some((target) => target.id === selectedId)) return;
    setError(null);
    try { await onConfirm(mode === "existing" ? selectedId! : undefined); }
    catch (failure) { setError(String(failure)); }
  };
  return <Modal title={`上传录像 · ${recording.encounterName}`} open={open} onCancel={onCancel} width={560} getContainer={false} closable={!busy} maskClosable={!busy}
    footer={<div className="flex justify-end gap-2"><Button aria-label="取消上传选择" disabled={busy} onClick={onCancel}>取消</Button>
      <Button type="primary" aria-label="确认上传到团队" loading={busy} disabled={!!blockedReason || mode === null || mode === "existing" && !targets.some((target) => target.id === selectedId)} onClick={() => void submit()}>确认上传</Button></div>}>
    <div className="space-y-4 py-2">
      <p className="text-xs text-[var(--app-text-secondary)]">选择本次录像所属的团队战斗。只有点击确认后才建立上传任务。</p>
      <Radio.Group className="flex flex-col gap-3" value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value); setError(null); }}>
        <Radio value="new">新建团队战斗</Radio><Radio value="existing">加入已有战斗</Radio>
      </Radio.Group>
      {mode === "new" && <p className="text-xs text-[var(--app-text-secondary)]">为当前录像建立新的团队场次，其他成员可明确选择加入。</p>}
      {mode === "existing" && <div className="space-y-3">
        <p className="text-xs text-[var(--app-text-secondary)]">仅列出同首领、同难度的授权场次，时间和场次编号供你核对。</p>
        <Select className="w-full" aria-label="选择已有团队战斗" placeholder="请明确选择团队场次" value={selectedId} disabled={busy} loading={catalog.loading} onChange={setSelectedId}
          options={targets.map((target) => ({ value: target.id, label: `${formatRecordingTime(target.startedAtUnixMs)} · ${target.encounterName} · ${target.recordingCount} 个成员记录 · ${target.id.slice(0, 8)}` }))} />
        {catalog.loading && targets.length === 0 && <Spin size="small" />}
        {!catalog.loading && targets.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前已加载目录没有同首领、同难度的团队场次" />}
        {catalog.hasMore && <Button size="small" loading={catalog.loading} onClick={() => void catalog.loadMore()}>加载更多已有战斗</Button>}
      </div>}
      {catalog.error && <Alert type="warning" showIcon message="读取已有团队战斗失败" description={catalog.error} action={<Button size="small" onClick={() => void catalog.refresh()}>重新读取场次</Button>} />}
      {blockedReason && <Alert type="warning" showIcon message={blockedReason} />}
      {error && <Alert type="error" showIcon message="上传任务创建失败" description={error} />}
    </div>
  </Modal>;
}
