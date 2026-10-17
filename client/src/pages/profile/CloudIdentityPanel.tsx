import { useState } from "react";
import { Alert, Avatar, Button, Descriptions, Empty, Space, Spin, Tag } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { useCloud } from "@/features/cloud/CloudProvider";

const roleLabels = { leader: "团队负责人", analyst: "分析员", member: "成员" };

/** 仅显示服务器已验证身份和授权团队，不用演示角色代替登录账号。 */
export function CloudIdentityPanel() {
  const cloud = useCloud();
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = cloud.settings?.identity;
  const verify = async () => {
    setVerifying(true); setError(null);
    try { await cloud.verify(); }
    catch (failure) { setError(String(failure)); }
    finally { setVerifying(false); }
  };
  if (cloud.loading && !cloud.settings) return <div className="py-12 text-center"><Spin tip="正在读取云端账号" /></div>;
  return <section className="mx-auto max-w-[960px] rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
    <div className="mb-6 flex items-center gap-4">
      <Avatar size={56} icon={<UserOutlined />} />
      <div><h2 className="m-0 text-base font-semibold">{identity?.displayName ?? "尚未连接账号"}</h2><p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">{identity ? "身份来自当前团队服务器" : "请在设置的“上传与存储”配置服务器和访问令牌"}</p></div>
    </div>
    {(error || cloud.error) && <Alert className="mb-4" type="error" showIcon message="账号信息暂不可用" description={error ?? cloud.error} />}
    <Descriptions column={1} bordered size="small">
      <Descriptions.Item label="连接状态">{identity ? "已验证" : cloud.settings?.endpoint ? "连接尚未验证" : "尚未配置服务器"}</Descriptions.Item>
      <Descriptions.Item label="团队服务器">{cloud.settings?.endpoint || "未配置"}</Descriptions.Item>
      <Descriptions.Item label="当前上传团队">{identity?.teams.find((team) => team.teamId === cloud.settings?.teamId)?.name ?? "尚未选择"}</Descriptions.Item>
    </Descriptions>
    <div className="mt-6"><h3 className="mb-3 text-sm font-medium">已授权团队</h3>
      {identity && identity.teams.length > 0 ? <ul className="space-y-2">{identity.teams.map((team) => <li key={team.teamId} className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] py-2 text-sm"><span>{team.name}</span><Space size="small"><Tag>{roleLabels[team.role]}</Tag>{team.teamId === cloud.settings?.teamId && <Tag color="processing">当前上传团队</Tag>}</Space></li>)}</ul>
        : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={identity ? "当前账号没有已授权团队" : "连接验证后显示实际授权的团队"} />}
    </div>
    <Button className="mt-5" aria-label="验证并刷新身份" loading={verifying} disabled={!cloud.settings?.endpoint || !cloud.settings.hasToken} onClick={() => void verify()}>验证并刷新身份</Button>
  </section>;
}
