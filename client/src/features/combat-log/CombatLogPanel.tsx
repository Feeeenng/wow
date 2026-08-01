import { Button } from "antd";
import { CheckCircle2, FileText } from "lucide-react";
import "@/features/combat-log/CombatLogPanel.css";

const logRows = [
  { label: "日志路径", value: "D:\\World of Warcraft\\_retail_\\Logs", action: "更改路径" },
  { label: "日志文件检测", value: "已检测到日志文件", action: "立即检测", success: true },
  { label: "解析状态", value: "实时解析中", action: "查看详情", success: true },
  { label: "过滤规则", value: "已启用过滤（仅保留战斗相关事件）", action: "配置过滤器" },
];

/** 展示首页战斗日志静态状态。 */
export function CombatLogPanel() {
  return (
    <section className="ornate-panel log-panel" aria-labelledby="log-panel-title">
      <div className="panel-heading">
        <div><h2 id="log-panel-title"><FileText /> 战斗日志设置</h2><p>配置战斗日志路径、解析与过滤</p></div>
        <span className="status-pill"><CheckCircle2 size={13} /> 监控中</span>
      </div>
      <div className="log-settings">
        {logRows.map((row) => (
          <div className="log-row" key={row.label}>
            <span>{row.label}</span>
            <strong className={row.success ? "success-value" : undefined}>{row.success && <CheckCircle2 size={15} />}{row.value}</strong>
            <Button disabled>{row.action}</Button>
          </div>
        ))}
        <div className="current-log"><span>当前日志文件</span><strong>WoWCombatLog_0519.log</strong><em>正在写入</em><small>128.4 MB</small></div>
      </div>
      <div className="log-metrics">
        <div><span>事件总数</span><strong>28,945</strong></div><div><span>每秒事件数</span><strong>215 EPS</strong></div><div><span>解析延迟</span><strong>120 ms</strong></div>
      </div>
    </section>
  );
}
