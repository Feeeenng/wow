import {
  HomeOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { AppRoute } from "@/components/layout/navigation";

interface AppSidebarProps {
  activeRoute: AppRoute;
  onNavigate: (route: AppRoute) => void;
}

const navigationItems = [
  { key: "home", label: "首页", icon: HomeOutlined },
  { key: "replay", label: "回放", icon: PlayCircleOutlined },
  { key: "live", label: "直播", icon: VideoCameraOutlined },
  { key: "profile", label: "个人中心", icon: UserOutlined },
  { key: "settings", label: "设置", icon: SettingOutlined },
] satisfies Array<{ key: AppRoute; label: string; icon: typeof HomeOutlined }>;

/** 渲染客户端固定的五项一级导航。 */
export function AppSidebar({ activeRoute, onNavigate }: AppSidebarProps) {
  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-surface)]">
      <div className="flex h-16 items-center gap-3 border-b border-[var(--app-border)] px-5">
        <img className="h-9 w-9 rounded" src="/assets/brand-logo.png" alt="" />
        <div className="min-w-0">
          <strong className="block truncate text-[15px]">WoW Recorder</strong>
          <span className="text-xs text-[var(--app-text-secondary)]">桌面客户端</span>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="主导航">
        {navigationItems.map(({ key, label, icon: Icon }) => {
          const active = key === activeRoute;
          return (
            <button
              key={key}
              type="button"
              className={`flex h-11 items-center gap-3 rounded px-4 text-left text-sm transition-colors ${
                active
                  ? "bg-[color-mix(in_srgb,var(--app-primary)_10%,white)] font-medium text-[var(--app-primary)]"
                  : "text-[var(--app-text-secondary)] hover:bg-gray-50 hover:text-[var(--app-text)]"
              }`}
              aria-current={active ? "page" : undefined}
              onClick={() => onNavigate(key)}
            >
              <Icon className="text-[18px]" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      <div className="border-t border-[var(--app-border)] px-5 py-4 text-xs text-[var(--app-text-secondary)]">
        <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />
        客户端运行正常
      </div>
    </aside>
  );
}
