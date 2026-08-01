import type { PropsWithChildren } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { DesktopTitleBar } from "@/components/layout/DesktopTitleBar";
import type { AppRoute } from "@/components/layout/navigation";

interface AppLayoutProps extends PropsWithChildren {
  activeRoute: AppRoute;
  pageTitle: string;
  onNavigate: (route: AppRoute) => void;
}

/** 提供所有一级页面共享的侧栏、标题栏和内容区域。 */
export function AppLayout({ activeRoute, pageTitle, onNavigate, children }: AppLayoutProps) {
  return (
    <div className="flex h-screen min-h-[720px] min-w-[1080px] overflow-hidden bg-[var(--app-bg)] text-[var(--app-text)]">
      <AppSidebar activeRoute={activeRoute} onNavigate={onNavigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DesktopTitleBar title={pageTitle} />
        <main className="min-h-0 flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
