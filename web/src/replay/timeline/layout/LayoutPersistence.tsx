import { Alert, Button, Popconfirm, Space } from "antd";
import { useTimelineLayout } from "@/replay/timeline/layout/TimelineProvider";

/** 保存不阻断播放器；读取失败或版本冲突均保留本地草稿，不自动覆盖。 */
export function LayoutPersistence({ team }: { team: string }) {
  const { document, dirty, save, reload } = useTimelineLayout(team);
  const busy = document.loading || document.saving;
  const read = <Button size="small" disabled={busy} onClick={dirty ? undefined : () => void reload()}>读取最新布局</Button>;
  return <div className="personal-layout-persistence">
    <p role="status">{document.loading ? "正在读取个人布局…" : !document.loaded ? "个人布局尚未读取，草稿未保存。"
      : dirty ? "个人布局有未保存的修改。" : "个人布局已与服务器同步。"}</p>
    {document.error && <Alert type="error" showIcon message={document.conflict ? "个人布局已在其他页面修改，当前草稿已保留。请读取最新布局后复核。" : document.error} />}
    <Space wrap>
      <Button size="small" type="primary" aria-label="保存个人布局" loading={document.saving} disabled={!document.loaded || busy || !dirty || document.conflict} onClick={() => void save()}>保存个人布局</Button>
      {dirty ? <Popconfirm title="读取最新布局会替换当前未保存的草稿，是否继续？" okText="替换草稿" cancelText="保留草稿" onConfirm={() => void reload()}>{read}</Popconfirm> : read}
    </Space>
  </div>;
}
