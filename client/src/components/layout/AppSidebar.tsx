import {
  BarChart3,
  Clock3,
  Database,
  HeartPulse,
  Home,
  RotateCcw,
  Settings,
  Sparkles,
  Upload,
  Users,
} from "lucide-react";
import "@/components/layout/AppSidebar.css";

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

/** 渲染参考图中的固定桌面导航栏。 */
export function AppSidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="/assets/brand-logo.png" alt="" />
        <div><strong>WoW Recorder</strong><span>v2.0.0</span></div>
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
                <Icon size={20} strokeWidth={1.8} />
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
  );
}
