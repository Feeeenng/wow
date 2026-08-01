import { Avatar, Button, Descriptions } from "antd";
import { UserOutlined } from "@ant-design/icons";

/** 展示当前客户端用户和团队绑定信息。 */
export function ProfilePage() {
  return (
    <section className="mx-auto max-w-[960px] border border-[var(--app-border)] bg-[var(--app-surface)] p-6">
      <div className="mb-6 flex items-center gap-4">
        <Avatar size={56} icon={<UserOutlined />} />
        <div>
          <h2 className="m-0 text-base font-semibold">木土猎人</h2>
          <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">尚未绑定团队</p>
        </div>
      </div>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="客户端版本">v0.1.0</Descriptions.Item>
        <Descriptions.Item label="服务区域">中国区正式服</Descriptions.Item>
        <Descriptions.Item label="账号状态">本地演示账号</Descriptions.Item>
      </Descriptions>
      <Button className="mt-5" type="primary" disabled>登录并绑定团队</Button>
    </section>
  );
}
