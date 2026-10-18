import { useMemo, useState } from "react";
import { Alert, Button, Checkbox, Drawer, Empty, Input, Popconfirm, Select, Space, Table, Tag, Tooltip } from "antd";
import { DeleteOutlined, FolderOpenOutlined, PlayCircleOutlined, ReloadOutlined, SearchOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import { recordingManagement, type ManagedRecording } from "@/features/recording/management";
import { formatDifficulty, formatRecordingTime, isRecordingPlayable, recordingStatusLabel } from "@/pages/replay/model";
import { filterLibrary, formatManagedBytes, type LibraryStatus } from "@/pages/replay/library/model";
import { useRecordingLibrary } from "@/pages/replay/library/useRecordingLibrary";

export interface RecordingLibraryProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onPlay: (pullId: string) => void | Promise<void>;
  onBeforeDelete: (pullId: string) => void | Promise<void>;
}

/** 本地录像管理只操作客户端成片，导入原片和所有日志始终保留。 */
export function RecordingLibrary({ open, onClose, onChanged, onPlay, onBeforeDelete }: RecordingLibraryProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LibraryStatus>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const { recordings, loading, busyId, error, refresh, act } = useRecordingLibrary(open, onChanged);
  const rows = useMemo(() => filterLibrary(recordings, search, status, favoritesOnly), [recordings, search, status, favoritesOnly]);
  const totalBytes = recordings.reduce((total, recording) => total + recording.bytes, 0);
  const disabled = loading || busyId !== null;

  return <Drawer title="本地录像管理" open={open} onClose={onClose} width="min(1040px, calc(100vw - 32px))" closable={busyId === null} maskClosable={busyId === null} keyboard={busyId === null}>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Input className="!w-64 !max-w-full" allowClear prefix={<SearchOutlined />} aria-label="搜索管理录像" placeholder="搜索首领、玩家、日期" value={search} onChange={(event) => setSearch(event.target.value)} />
      <Select className="!w-40" aria-label="录像状态筛选" value={status} onChange={setStatus} options={[
        { value: "all", label: "全部状态" }, { value: "playable", label: "可回放" }, { value: "busy", label: "录制或处理中" }, { value: "failed", label: "失败或中断" },
      ]} />
      <Checkbox checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)}>只看收藏</Checkbox>
      <Button aria-label="刷新管理录像" icon={<ReloadOutlined />} loading={loading} disabled={busyId !== null} onClick={() => void refresh()}>刷新</Button>
    </div>
    <div className="mb-3 text-xs text-[var(--app-text-secondary)]">{recordings.length} 个视角 · 客户端成片 {formatManagedBytes(totalBytes)}。删除只移除客户端成片与回放文件，保留导入原片、OBS原始录像和所有日志。</div>
    {error && <Alert className="mb-3" type="error" showIcon title="录像操作失败" description={error} action={<Button size="small" disabled={disabled} onClick={() => void refresh()}>重试刷新</Button>} />}
    <Table<ManagedRecording> rowKey="pullId" dataSource={rows} loading={loading} size="small" scroll={{ x: 850 }} pagination={{ pageSize: 12, hideOnSinglePage: true, showSizeChanger: false }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={recordings.length ? "没有符合筛选条件的录像" : "暂无本地录像"} /> }} columns={[
      { title: "录像", key: "recording", width: 240, render: (_, recording) => <div className="min-w-0 py-2"><strong>{recording.encounterName}</strong><div className="mt-1 text-xs text-[var(--app-text-secondary)]">{formatDifficulty(recording.difficultyId)} · {recording.playerName || "未识别视角"}</div><div className="text-xs text-[var(--app-text-secondary)]">{formatRecordingTime(recording.encounterStartUnixMs)}</div></div> },
      { title: "状态", key: "status", width: 150, render: (_, recording) => <Tooltip title={recording.error}><Tag color={recording.state === "failed" || recording.state === "interrupted" ? "error" : undefined}>{recordingStatusLabel(recording)}</Tag></Tooltip> },
      { title: "成片空间", key: "size", width: 110, render: (_, recording) => formatManagedBytes(recording.bytes) },
      { title: "操作", key: "actions", width: 320, render: (_, recording) => <Space size="small" wrap>
        <Button size="small" icon={<PlayCircleOutlined />} disabled={disabled || !isRecordingPlayable(recording)} onClick={() => void act(recording.pullId, async () => { await onPlay(recording.pullId); onClose(); })}>播放</Button>
        <Button size="small" icon={recording.isFavorited ? <StarFilled /> : <StarOutlined />} aria-label={`${recording.isFavorited ? "取消收藏" : "收藏"}${recording.encounterName}`} disabled={disabled} loading={busyId === recording.pullId} onClick={() => void act(recording.pullId, () => recordingManagement.favorite(recording.pullId, !recording.isFavorited), true)}>{recording.isFavorited ? "已收藏" : "收藏"}</Button>
        <Tooltip title={recording.canOpenDirectory ? "打开客户端成片目录" : "受管理目录不可用"}><Button size="small" icon={<FolderOpenOutlined />} aria-label={`打开${recording.encounterName}录像目录`} disabled={disabled || !recording.canOpenDirectory} onClick={() => void act(recording.pullId, () => recordingManagement.openDirectory(recording.pullId))} /></Tooltip>
        <Tooltip title={recording.blockedReason ?? "删除客户端成片"}><span><Popconfirm title="删除这份客户端录像？" description="只删除客户端成片与回放文件，导入原片、OBS源录像和日志全部保留。" okText="删除成片" cancelText="取消" okButtonProps={{ danger: true }} disabled={disabled || !recording.canDelete} onConfirm={() => act(recording.pullId, async () => { await onBeforeDelete(recording.pullId); await recordingManagement.delete(recording.pullId); }, true)}><Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除${recording.encounterName}客户端成片`} disabled={disabled || !recording.canDelete} /></Popconfirm></span></Tooltip>
      </Space> },
    ]} />
  </Drawer>;
}
