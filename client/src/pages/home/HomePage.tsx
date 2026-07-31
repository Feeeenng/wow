import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Database,
  Flame,
  HeartPulse,
  Home,
  Play,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import { BattleLogPanel } from "./BattleLogPanel";
import { ObsSetupPanel } from "./ObsSetupPanel";
import { RecentRecords } from "./RecentRecords";
import { StatusOverview } from "./StatusOverview";
import { WindowControls } from "./WindowControls";
import "./HomePage.css";

const navigationGroups = [
  [
    { label: "首页", icon: Home, active: true },
    { label: "回放查看", icon: RotateCcw },
    { label: "事件时间轴", icon: Clock3 },
    { label: "伤害分析", icon: BarChart3 },
    { label: "治疗分析", icon: HeartPulse },
    { label: "资源分析", icon: Database },
    { label: "增益统计", icon: Sparkles },
  ],
  [
    { label: "团队管理", icon: Users },
    { label: "数据导出", icon: Upload },
    { label: "设置中心", icon: Settings },
  ],
];

const setupSteps = [
  { number: 1, title: "配置 OBS", description: "设置录制参数与输出路径", action: "去配置" },
  { number: 2, title: "配置战斗日志", description: "选择日志目录与过滤规则", action: "去配置" },
  { number: 3, title: "开始记录", description: "开启战斗记录与日志监控", action: "去记录" },
  { number: 4, title: "分析复盘", description: "生成事件时间线与报告", action: "去复盘" },
];

/** 渲染与参考图一致的桌面客户端首页信息架构。 */
export function HomePage() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Flame size={27} /></div>
          <div>
            <strong>WoW Recorder</strong>
            <span>v0.1.0</span>
          </div>
        </div>

        <nav aria-label="主导航">
          {navigationGroups.map((group, groupIndex) => (
            <div className="nav-group" key={groupIndex}>
              {group.map(({ label, icon: Icon, active }) => (
                <button
                  type="button"
                  className={active ? "nav-item active" : "nav-item"}
                  aria-current={active ? "page" : undefined}
                  disabled={!active}
                  key={label}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-status">
          <span><i /> 服务状态</span>
          <strong>全部服务运行正常</strong>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar" data-tauri-drag-region>
          <div className="page-title">
            <h1>首页</h1>
            <p>为艾泽拉斯的每一场战斗，留下完美复盘。<strong>12.0</strong></p>
          </div>
          <div className="topbar-actions">
            <button type="button" className="header-action" disabled>
              <CircleHelp size={17} />
              <span>帮助文档</span>
            </button>
            <button type="button" className="header-action" disabled>
              <Settings size={17} />
              <span>设置</span>
            </button>
            <button type="button" className="user-menu" disabled>
              <span className="user-avatar"><Flame size={17} /></span>
              <span>木土猎人</span>
              <ChevronDown size={15} />
            </button>
            <WindowControls />
          </div>
        </header>

        <div className="page-content">
          <section className="quick-start" aria-labelledby="quick-start-title">
            <div className="quick-start-heading">
              <div>
                <span><Play size={17} /></span>
                <div>
                  <h2 id="quick-start-title">快速开始</h2>
                  <p>新手引导只需 4 步，即可开始录制与复盘</p>
                </div>
              </div>
              <button type="button" className="banner-config" disabled>
                首页插画可配置 <SlidersHorizontal size={14} />
              </button>
            </div>
            <div className="setup-steps">
              {setupSteps.map((step, index) => (
                <div className="setup-step" key={step.number}>
                  <div className="step-number">{step.number}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <p>{step.description}</p>
                    <span>{step.action}</span>
                  </div>
                  {index < setupSteps.length - 1 && <ChevronRight className="step-arrow" size={18} />}
                </div>
              ))}
            </div>
          </section>

          <div className="dashboard-grid">
            <ObsSetupPanel />
            <BattleLogPanel />
            <RecentRecords />
          </div>

          <StatusOverview />

        </div>
      </main>
    </div>
  );
}
