import { AppSidebar } from "@/components/layout/AppSidebar";
import { DesktopTitleBar } from "@/components/layout/DesktopTitleBar";
import { CombatLogPanel } from "@/features/combat-log/CombatLogPanel";
import { ObsSummaryPanel } from "@/features/obs/ObsSummaryPanel";
import { RecentRecordsPanel } from "@/features/recordings/RecentRecordsPanel";
import { SystemStatusPanel } from "@/features/system-status/SystemStatusPanel";
import { QuickStartPanel } from "@/pages/home/QuickStartPanel";
import "@/pages/home/HomePage.css";

/** 渲染与参考图一致的桌面客户端首页信息架构。 */
export function HomePage() {
  return (
    <div className="app-shell">
      <AppSidebar />

      <main className="main-content">
        <DesktopTitleBar />

        <div className="page-content">
          <QuickStartPanel />

          <div className="dashboard-grid">
            <ObsSummaryPanel />
            <CombatLogPanel />
            <RecentRecordsPanel />
          </div>
          <SystemStatusPanel />
        </div>
      </main>
    </div>
  );
}
