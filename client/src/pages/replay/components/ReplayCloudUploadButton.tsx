import { useState } from "react";
import { Button, Tooltip, message } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
import { useCloud } from "@/features/cloud/CloudProvider";
import type { LocalRecording } from "@/shared/replay/model";
import { UploadTargetDialog } from "@/pages/replay/uploading/UploadTargetDialog";

/** 上传只由用户显式触发，未验证身份、团队或完整成片时说明禁用原因。 */
export function ReplayCloudUploadButton({ recording }: { recording: LocalRecording | null }) {
  const cloud = useCloud();
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [feedback, holder] = message.useMessage();
  const settings = cloud.settings;
  const job = cloud.jobs.find((item) => item.pullId === recording?.pullId && item.teamId === settings?.teamId && item.origin === settings?.endpoint);
  const blocked = !recording ? "请选择一场录像" : !settings?.endpoint ? "请先在设置的上传与存储配置服务器"
    : !settings.hasToken ? "请先保存服务器访问令牌" : !settings.identity ? "请先验证服务器连接"
      : !settings.teamId || !settings.identity.teams.some((team) => team.teamId === settings.teamId) ? "请先选择服务器已授权的上传团队"
        : !recording.videoPath || !["ready", "partial"].includes(recording.state) || recording.encounterEndUnixMs === null ? "录像尚未完成，完成后才可上传"
          : job && !["paused", "failed", "cancelled", "unverified"].includes(job.status) ? "该录像已有上传任务，请在设置的上传与存储查看" : null;
  const upload = async () => {
    if (!recording || blocked || busy) return;
    if (!job) { setChoosing(true); return; }
    setBusy(true);
    try {
      await cloud.retry(job.jobId);
      void feedback.success("已加入上传队列，可在上传与存储查看进度");
    } catch (failure) { void feedback.error(String(failure)); }
    finally { setBusy(false); }
  };
  const confirm = async (teamPullId?: string) => {
    if (!recording || blocked || busy) throw new Error(blocked ?? "当前录像暂不可上传");
    setBusy(true);
    try { await cloud.enqueue(recording.pullId, teamPullId); setChoosing(false); void feedback.success("已加入上传队列，可在上传与存储查看进度"); }
    finally { setBusy(false); }
  };
  const label = job?.status === "failed" ? "重试上传" : job?.status === "paused" ? "继续上传" : job?.status === "cancelled" ? "重新上传" : "上传录像";
  return <>{holder}<Tooltip title={blocked ?? "仅上传当前选中的录像"}><span><Button size="small" aria-label={label} icon={<CloudUploadOutlined />} disabled={blocked !== null || busy} loading={busy} onClick={() => void upload()}>{label}</Button></span></Tooltip>
    {recording && <UploadTargetDialog open={choosing} recording={recording} connectionScope={`${settings?.connectionKey ?? ""}:${settings?.teamId ?? ""}`} busy={busy} blockedReason={blocked}
      onCancel={() => setChoosing(false)} onConfirm={confirm} />}</>;
}
