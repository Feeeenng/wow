import { CheckCircleOutlined, ExclamationCircleOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Switch, Tag } from "antd";
import { useCombatLogSettings } from "@/features/combat-log/useCombatLogSettings";

/** 在设置中心展示战斗日志路径与监控选项。 */
export function CombatLogSettings() {
  const { status, loading, error, refresh, chooseDirectory, setMonitoring } = useCombatLogSettings();
  const available = Boolean(status.directory && status.currentFile && !status.error);

  return (
    <section className="border border-[var(--app-border)] bg-[var(--app-surface)]">
      <header className="border-b border-[var(--app-border)] px-5 py-4">
        <h2 className="m-0 text-base font-semibold">战斗日志</h2>
        <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">配置魔兽世界 CombatLog 路径和自动监控。</p>
      </header>
      <div className="space-y-5 p-5">
        {(error || status.error) && (
          <Alert type="error" showIcon message="战斗日志不可用" description={error ?? status.error} />
        )}
        <div className="grid grid-cols-[140px_minmax(0,1fr)_auto] items-center gap-3 max-[760px]:grid-cols-1">
          <label className="text-sm">日志目录</label>
          <Input value={status.directory ?? "尚未发现正式服日志目录"} readOnly />
          <Button icon={<FolderOpenOutlined />} loading={loading} onClick={() => void chooseDirectory()}>
            选择目录
          </Button>
        </div>
        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3 border-t border-[var(--app-border)] pt-5">
          <span className="text-sm">目录状态</span>
          <Tag
            icon={available ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
            color={available ? "success" : "warning"}
          >
            {available
              ? status.monitoring ? "正在监控 CombatLog" : "日志监控已暂停"
              : status.discoveryState === "multiple" ? "发现多个目录，请手动选择" : "未检测到可用 CombatLog"}
          </Tag>
        </div>
        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
          <span className="text-sm">当前文件</span>
          <span className="truncate text-sm text-[var(--app-text-secondary)]" title={status.currentFile ?? undefined}>
            {status.currentFile ?? "尚未找到 WoWCombatLog 文件"}
          </span>
        </div>
        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
          <span className="text-sm">自动监控</span>
          <Switch
            checked={status.monitoring}
            loading={loading}
            disabled={!status.directory}
            onChange={(checked) => void setMonitoring(checked)}
          />
        </div>
        <Button onClick={() => void refresh()} loading={loading}>重新检测</Button>
      </div>
    </section>
  );
}
