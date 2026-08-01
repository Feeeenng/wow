import { ChevronRight, Play } from "lucide-react";
import { obsService } from "@/features/obs/obsService";

const setupSteps = [
  { number: 1, title: "配置 OBS", description: "设置录制参数与输出路径", action: "去配置", enabled: true },
  { number: 2, title: "配置战斗日志", description: "选择日志目录与过滤规则", action: "去配置" },
  { number: 3, title: "开始记录", description: "开启战斗记录与日志监控", action: "去记录" },
  { number: 4, title: "分析复盘", description: "生成事件时间线与数据报告", action: "去复盘" },
];

/** 渲染参考图中的四步快速开始流程。 */
export function QuickStartPanel() {
  return (
    <section className="ornate-panel quick-start" aria-labelledby="quick-start-title">
      <div className="quick-start-heading">
        <span><Play size={17} /></span>
        <h2 id="quick-start-title">快速开始</h2>
        <p>新手引导只需 4 步，即可开始录制与复盘</p>
      </div>
      <div className="setup-steps">
        {setupSteps.map((step, index) => (
          <div className="setup-step" key={step.number}>
            <div className="step-number">{step.number}</div>
            <div><strong>{step.title}</strong><p>{step.description}</p><button type="button" disabled={!step.enabled} onClick={step.enabled ? () => void obsService.openControlWindow() : undefined}>{step.action}</button></div>
            {index < setupSteps.length - 1 && <span className="step-arrow"><ChevronRight size={16} /></span>}
          </div>
        ))}
      </div>
    </section>
  );
}
