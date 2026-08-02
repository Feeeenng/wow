import { useMemo, useState } from "react";
import { ConfigProvider } from "antd";
import { AppLayout } from "@/components/layout/AppLayout";
import type { AppRoute } from "@/components/layout/navigation";
import { activeWowTheme, createAppTheme } from "@/app/theme";
import { HomePage } from "@/pages/home/HomePage";
import { LivePage } from "@/pages/live/LivePage";
import { ProfilePage } from "@/pages/profile/ProfilePage";
import { ReplayPage } from "@/pages/replay/ReplayPage";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { ObsSettingsProvider } from "@/features/obs/ObsSettingsProvider";

const pageTitles: Record<AppRoute, string> = {
  home: "首页",
  replay: "回放",
  live: "直播",
  profile: "个人中心",
  settings: "设置中心",
};

/** 配置全局主题并组合一级页面，直播页常驻以保留播放连接。 */
export function App() {
  const [activeRoute, setActiveRoute] = useState<AppRoute>("home");
  const appTheme = useMemo(() => createAppTheme(activeWowTheme), []);

  const liveVisible = activeRoute === "live";
  const page = {
    home: <HomePage onOpenSettings={() => setActiveRoute("settings")} />,
    replay: <ReplayPage />,
    live: null,
    profile: <ProfilePage />,
    settings: <SettingsPage />,
  }[activeRoute];

  return (
    <ConfigProvider theme={appTheme}>
      <ObsSettingsProvider>
        <AppLayout
          activeRoute={activeRoute}
          pageTitle={pageTitles[activeRoute]}
          onNavigate={setActiveRoute}
        >
          <div className={liveVisible ? "block" : "hidden"} aria-hidden={!liveVisible}>
            <LivePage
              visible={liveVisible}
              onOpenSettings={() => setActiveRoute("settings")}
            />
          </div>
          {page}
        </AppLayout>
      </ObsSettingsProvider>
    </ConfigProvider>
  );
}
