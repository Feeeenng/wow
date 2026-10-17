import { useEffect, useState } from "react";
import { Alert, Button, Drawer, Empty, Input, Progress, Space, Spin, Tag } from "antd";
import { FileTextOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useRecordingImport } from "@/features/recording/importing/RecordingImportProvider";
import { isImportRunning } from "@/features/recording/importing/model";

interface Props { open: boolean; onClose: () => void; }

const statusLabels = {
  idle: "尚未开始", scanning: "正在匹配录像与日志", indexing: "正在建立战斗事件索引",
  completed: "录像索引导入完成", cancelled: "已取消导入", failed: "导入失败",
};

/** 选择真实目录与完整日志，展示原生任务进度；关闭面板不会中止后台导入。 */
export function RecordingImportDrawer({ open, onClose }: Props) {
  const importer = useRecordingImport();
  const [directory, setDirectory] = useState(importer.preferences.directory);
  const [logPaths, setLogPaths] = useState(importer.preferences.logPaths);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const running = isImportRunning(importer.progress);
  const locked = running || importer.submitting;
  useEffect(() => {
    if (open) { setDirectory(importer.preferences.directory); setLogPaths(importer.preferences.logPaths); }
  }, [open, importer.preferences]);
  const chooseDirectory = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, title: "选择录像与旁车文件所在目录", defaultPath: directory || undefined });
      if (typeof selected === "string") { setDirectory(selected); setSelectionError(null); }
    } catch (failure) { setSelectionError(String(failure)); }
  };
  const chooseLogs = async () => {
    try {
      const selected = await openDialog({ directory: false, multiple: true, title: "选择完整 WoW 战斗日志", filters: [{ name: "战斗日志", extensions: ["txt", "log"] }] });
      if (selected) { setLogPaths(typeof selected === "string" ? [selected] : selected); setSelectionError(null); }
    } catch (failure) { setSelectionError(String(failure)); }
  };
  const { progress } = importer;
  const percent = progress.totalBytes > 0 ? Math.min(100, Math.round(progress.bytesRead / progress.totalBytes * 100))
    : progress.totalRecordings > 0 ? Math.min(100, Math.round(progress.processedRecordings / progress.totalRecordings * 100)) : 0;
  return <Drawer title="导入本地录像与战斗日志" open={open} onClose={onClose} width={480} getContainer={false}
    footer={<Space wrap>
      <Button type="primary" disabled={!importer.ready || locked || !directory || logPaths.length === 0} loading={importer.submitting && !running} onClick={() => void importer.start({ directory, logPaths })}>开始导入</Button>
      {running && <Button loading={importer.submitting} onClick={() => void importer.cancel()}>取消导入</Button>}
      <Button onClick={onClose}>关闭面板</Button>
    </Space>}>
    <div className="replay-import-content">
      {!importer.ready && <Spin tip="正在读取导入设置" />}
      {(importer.error || selectionError) && <Alert type="error" showIcon message="录像导入暂不可用" description={selectionError ?? importer.error}
        action={<Button size="small" onClick={importer.refresh}>重新检测</Button>} />}
      <p>选择包含录像及配套资料的目录，再选择对应的完整战斗日志。原始录像和日志保持原样，播放文件在应用目录生成。</p>
      <label htmlFor="recording-import-directory">录像目录</label>
      <Input id="recording-import-directory" aria-label="待导入录像目录" readOnly value={directory} placeholder="请选择本地录像目录" addonAfter={<Button type="text" size="small" icon={<FolderOpenOutlined />} disabled={locked} aria-label="选择导入录像目录" onClick={() => void chooseDirectory()} />} />
      <div className="flex items-center justify-between gap-2"><strong className="text-xs">完整战斗日志</strong><Button size="small" icon={<FileTextOutlined />} disabled={locked} onClick={() => void chooseLogs()}>选择日志文件</Button></div>
      {logPaths.length > 0 ? <ul className="replay-import-files">{logPaths.map((path) => <li key={path} title={path}>{path}</li>)}</ul>
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择战斗日志，可一次选择多个文件" />}
      <section className="replay-import-progress" aria-label="录像导入进度" aria-live="polite">
        <div className="flex items-center justify-between gap-2"><strong>{statusLabels[progress.status]}</strong><Tag color={running ? "processing" : progress.status === "failed" ? "error" : "default"}>{progress.processedRecordings} / {progress.totalRecordings}</Tag></div>
        <Progress percent={progress.status === "completed" ? 100 : percent} status={progress.status === "failed" ? "exception" : running ? "active" : "normal"} />
        {progress.currentFile && <p className="break-all">{progress.currentFile}</p>}
        <p>已导入 {progress.importedCount} · 已跳过 {progress.skippedCount} · 失败 {progress.failedCount}</p>
        {progress.status === "completed" && <Alert type="success" showIcon message="录像已加入本地列表" description="事件索引已导入；视频仍可能在生成播放文件，请以录像列表的实际状态为准。" />}
        {progress.status === "cancelled" && <Alert type="info" showIcon message="已导入的场次会保留，已排队的视频继续处理。" />}
        {progress.error && <Alert type="error" showIcon message={progress.error} />}
        {progress.issues.length > 0 && <details><summary>查看导入提示（{progress.issues.length}）</summary><ul className="replay-import-files">{progress.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
      </section>
    </div>
  </Drawer>;
}
