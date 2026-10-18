import { useState } from "react";
import { Button, Popover } from "antd";
import { MoreOutlined, ReloadOutlined } from "@ant-design/icons";
import type { LocalRecording } from "@/shared/replay/model";
import { ReplayCloudUploadButton } from "@/pages/replay/components/ReplayCloudUploadButton";
import { WclReportButton } from "@/pages/replay/components/WclReportButton";

interface Props {
  recording: LocalRecording | null;
  recordings: LocalRecording[];
  refreshing: boolean;
  onRefresh: () => void;
  onImport: () => void;
  source: "local" | "team";
}

/** 低频管理入口统一收进左栏，弹层隐藏时保留上传和标准事件对话框状态。 */
export function ReplayActions({ recording, recordings, refreshing, onRefresh, onImport, source }: Props) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight"
    content={<div className="replay-actions" role="group" aria-label="录像管理操作">
      <Button size="small" onClick={() => { setOpen(false); onImport(); }}>导入录像</Button>
      {source === "local" ? <ReplayCloudUploadButton recording={recording} />
        : <WclReportButton recording={recording} recordings={recordings} onPublished={onRefresh} />}
      <Button size="small" icon={<ReloadOutlined spin={refreshing} />} disabled={refreshing} onClick={() => { setOpen(false); onRefresh(); }}
        aria-label={source === "team" ? "刷新团队录像" : "刷新本地录像"}>刷新录像</Button>
    </div>}>
    <Button size="small" type="text" icon={<MoreOutlined style={{ fontSize: 16 }} />} title="更多录像操作" aria-label="更多录像操作" />
  </Popover>;
}
