import { useState } from "react";
import { Alert, Button, Empty, Progress, Space, Spin, Table, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { useCloud } from "@/features/cloud/CloudProvider";
import type { CloudUploadJob } from "@/features/cloud/model";

const statusLabels: Record<CloudUploadJob["status"], string> = {
  unverified: "等待核对", queued: "排队中", checking: "核对文件", hashing: "校验录像", registering: "准备上传", uploading: "上传中",
  paused: "已暂停", cancelling: "正在取消", cancelled: "已取消", uploaded: "文件已上传", failed: "上传失败",
};

function formatBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = Math.max(0, bytes); let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** 展示原生上传真值，文件已上传与云端播放就绪分别表达。 */
export function CloudUploadQueue() {
  const cloud = useCloud();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const operate = async (jobId: string, action: "retry" | "pause" | "cancel") => {
    if (pending) return;
    setPending(jobId); setError(null);
    try { await cloud[action](jobId); }
    catch (failure) { setError(String(failure)); }
    finally { setPending(null); }
  };
  const columns: TableColumnsType<CloudUploadJob> = [
    { title: "录像", key: "recording", width: 180, render: (_, job) => <div className="min-w-0"><strong className="block text-xs">{job.encounterName || `录像 ${job.pullId.slice(0, 12)}`}</strong><span className="block truncate text-[11px] text-[var(--app-text-secondary)]" title={job.origin}>{job.origin}</span><span className="block text-[11px] text-[var(--app-text-secondary)]">目标：{job.teamPullId ? `场次 ${job.teamPullId.slice(0, 8)}` : "新建团队战斗"}</span></div> },
    { title: "上传进度", key: "progress", width: 230, render: (_, job) => <div className="min-w-[170px]">
      <Progress size="small" percent={job.fileSizeBytes > 0 ? Math.min(100, Math.floor(job.uploadedBytes / job.fileSizeBytes * 100)) : 0} status={job.status === "failed" ? "exception" : job.status === "uploading" ? "active" : "normal"} />
      <span className="text-xs tabular-nums text-[var(--app-text-secondary)]" title={`${job.uploadedBytes} / ${job.fileSizeBytes} 字节`}>{formatBytes(job.uploadedBytes)} / {formatBytes(job.fileSizeBytes)}</span>
    </div> },
    { title: "状态", key: "status", width: 200, render: (_, job) => <div className="space-y-1">
      <Tag color={job.status === "failed" ? "error" : job.status === "uploading" ? "processing" : "default"}>{statusLabels[job.status]}</Tag>
      {job.recordingStatus === "ready" ? <span className="block text-xs text-green-700">云端播放已就绪</span> : job.status === "uploaded" ? <span className="block text-xs text-[var(--app-text-secondary)]">{job.recordingStatus === "failed" ? "云端处理失败" : "等待云端处理完成"}</span> : null}
      {job.fullFileSha256Verified && <span className="block text-[11px] text-[var(--app-text-secondary)]">整文件校验完成</span>}
      {job.error && <p className="m-0 break-words text-xs text-red-600">{job.error}</p>}
    </div> },
    { title: "操作", key: "actions", width: 180, render: (_, job) => {
      const resumable = ["unverified", "paused", "failed", "cancelled"].includes(job.status);
      const pausable = ["queued", "checking", "hashing", "registering", "uploading"].includes(job.status);
      const cancellable = !["uploaded", "cancelled", "cancelling"].includes(job.status);
      const canResume = job.origin === cloud.settings?.endpoint && cloud.settings?.identity?.teams.some((team) => team.teamId === job.teamId);
      const resumeLabel = job.status === "failed" ? "重试上传" : job.status === "cancelled" ? "重新上传" : "继续上传";
      return <Space wrap size="small">
        {resumable && <Tooltip title={canResume ? undefined : "请先连接该任务对应的服务器和授权团队"}><span><Button size="small" aria-label={resumeLabel} disabled={pending !== null || !canResume} loading={pending === job.jobId} onClick={() => void operate(job.jobId, "retry")}>{resumeLabel}</Button></span></Tooltip>}
        {pausable && <Button size="small" aria-label="暂停" disabled={pending !== null} onClick={() => void operate(job.jobId, "pause")}>暂停</Button>}
        {cancellable && <Button size="small" aria-label="取消" disabled={pending !== null} onClick={() => void operate(job.jobId, "cancel")}>取消</Button>}
        {job.status === "uploaded" && <Tooltip title="播放地址由云端处理完成后提供"><span className="text-xs text-[var(--app-text-secondary)]">{job.recordingStatus === "ready" ? "处理完成" : "等待处理"}</span></Tooltip>}
      </Space>;
    } },
  ];
  return <section className="rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-5">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="m-0 text-base font-medium">录像上传队列</h2><Button size="small" aria-label="刷新上传任务" loading={cloud.loading} onClick={() => void cloud.refresh().catch((failure) => setError(String(failure)))}>刷新上传任务</Button></div>
    <p className="mb-4 text-xs text-[var(--app-text-secondary)]">从回放页明确选择一场录像后点击上传。暂停或取消只作用于选定任务，原始本地录像保留。</p>
    {error && <Alert className="mb-4" type="error" showIcon message="上传操作失败" description={error} />}
    {cloud.loading && cloud.jobs.length === 0 ? <div className="py-10 text-center"><Spin /></div>
      : cloud.jobs.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无上传任务" />
        : <Table size="small" rowKey="jobId" dataSource={cloud.jobs} columns={columns} pagination={false} scroll={{ x: 790 }} />}
  </section>;
}
