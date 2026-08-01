import { CheckCircleOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Button, Input, Switch, Tag } from "antd";

/** 在设置中心展示战斗日志路径与监控选项。 */
export function CombatLogSettings() {
  return (
    <section className="border border-[var(--app-border)] bg-[var(--app-surface)]">
      <header className="border-b border-[var(--app-border)] px-5 py-4">
        <h2 className="m-0 text-base font-semibold">战斗日志</h2>
        <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">配置魔兽世界 CombatLog 路径和自动监控。</p>
      </header>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-3">
          <label className="text-sm">日志目录</label>
          <Input value="D:\\World of Warcraft\\_retail_\\Logs" readOnly />
          <Button icon={<FolderOpenOutlined />} disabled>选择目录</Button>
        </div>
        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 border-t border-[var(--app-border)] pt-5">
          <span className="text-sm">目录状态</span>
          <Tag icon={<CheckCircleOutlined />} color="success">已检测到日志目录</Tag>
        </div>
        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
          <span className="text-sm">自动监控</span>
          <Switch defaultChecked />
        </div>
      </div>
    </section>
  );
}
