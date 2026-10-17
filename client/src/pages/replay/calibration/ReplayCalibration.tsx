import { useState } from "react";
import { Alert, Button, InputNumber, Popconfirm, Popover, Spin } from "antd";
import type { LocalRecording } from "@/shared/replay/model";
import type { useReplayPlayback } from "@/features/replay/useReplayPlayback";
import { useCloud } from "@/features/cloud/CloudProvider";
import { useSharedCalibration } from "@/features/replay/calibration/useSharedCalibration";
import { sharedOffset } from "@/shared/replay/calibration";
import { REPLAY_OFFSET_STEP_MS } from "@/features/replay/config";

interface Props { recording: LocalRecording; playback: ReturnType<typeof useReplayPlayback>; disabled: boolean; }

function SharedCalibrationEditor({ recording, open }: { recording: LocalRecording; open: boolean }) {
  const editor = useSharedCalibration(recording, open);
  const snapshot = editor.snapshot;
  const allowed = editor.verified && snapshot?.canEdit && snapshot.playbackVersion === recording.cloudPlaybackVersion && recording.state === "ready";
  return <div className="space-y-2 border-t border-[var(--app-border)] pt-3">
    <strong className="text-xs">团队共享对齐</strong>
    <p className="text-xs text-[var(--app-text-secondary)]">保存后，团队成员重新读取该录像即可应用。个人微调仍会叠加。</p>
    {editor.loading && <Spin size="small" />}
    {snapshot?.stale && <Alert type="warning" showIcon message="录像版本已变化，旧团队偏移未应用；请按当前画面复核后再保存。" />}
    {editor.error && <Alert type="error" showIcon message={editor.error} />}
    {snapshot && <>
      <span className="block text-xs text-[var(--app-text-secondary)]">已读取：{snapshot.offsetMs} 毫秒{snapshot.active ? "（本页已应用）" : "（未应用）"}{snapshot.updatedAt ? ` · ${snapshot.updatedAt}` : ""}</span>
      <InputNumber aria-label="团队对齐偏移" value={editor.draft} step={REPLAY_OFFSET_STEP_MS} precision={0}
        min={snapshot.minOffsetMs} max={snapshot.maxOffsetMs} suffix="毫秒" disabled={!allowed || editor.loading || editor.saving}
        onChange={(value) => { if (Number.isSafeInteger(value)) editor.setDraft(value!); }} />
      {!snapshot.canEdit && <span className="block text-xs text-[var(--app-text-secondary)]">当前账号只读；上传者、团长或分析员可以保存。</span>}
    </>}
    <div className="flex flex-wrap gap-2">
      <Button size="small" type="primary" aria-label="保存团队对齐" loading={editor.saving} disabled={!allowed || editor.loading} onClick={() => void editor.save()}>保存团队对齐</Button>
      <Popconfirm title="用服务器当前值替换未保存的偏移？" disabled={!editor.dirty} onConfirm={() => void editor.reload()}>
        <Button size="small" aria-label="读取最新团队对齐" disabled={editor.loading || editor.saving} onClick={() => { if (!editor.dirty) void editor.reload(); }}>读取最新团队对齐</Button>
      </Popconfirm>
    </div>
  </div>;
}

/** 本机偏好与团队权威值分别显示，播放器只使用二者之和。 */
export function ReplayCalibration({ recording, playback, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const cloud = useCloud();
  return <div className="replay-calibration">
    <Popover title="调整画面对齐" trigger="click" open={open} onOpenChange={setOpen} content={(
      <div className="max-h-[calc(100dvh-96px)] max-w-[340px] space-y-3 overflow-y-auto">
        <p className="text-xs text-[var(--app-text-secondary)]">正值定位到更晚的画面，负值定位到更早的画面。</p>
        <span className="block text-xs">本机个人微调</span>
        {playback.personalOffsetNeedsReview && <Alert type="warning" showIcon message={`录像版本已变化，原本机偏移 ${playback.storedPersonalOffsetMs} 毫秒未应用。`}
          action={<Button size="small" onClick={() => playback.setOffset(playback.storedPersonalOffsetMs)}>复核并应用原本机偏移</Button>} />}
        <div className="flex items-center gap-2">
          <InputNumber aria-label="本机对齐偏移" value={playback.personalOffsetMs} step={REPLAY_OFFSET_STEP_MS} precision={0}
            suffix="毫秒" onChange={(value) => playback.setOffset(value ?? 0)} />
          <Button size="small" onClick={() => playback.setOffset(0)}>重置</Button>
        </div>
        {recording.sourceKind === "cloud" && <>
          <span className="block text-xs">当前生效：{playback.offsetMs} 毫秒（团队 {sharedOffset(recording)} ＋ 本机 {playback.personalOffsetMs}）</span>
          <SharedCalibrationEditor key={`${cloud.settings?.connectionKey}:${recording.pullId}:${recording.cloudPlaybackVersion}`} recording={recording} open={open} />
        </>}
      </div>
    )}><Button size="small" disabled={disabled}>对齐微调</Button></Popover>
  </div>;
}
