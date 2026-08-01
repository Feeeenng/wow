import { ChevronDown, CircleHelp, Settings } from "lucide-react";
import { WindowControls } from "@/components/layout/WindowControls";
import "@/components/layout/DesktopTitleBar.css";

/** 渲染首页标题、用户信息和桌面窗口控制。 */
export function DesktopTitleBar() {
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="page-title">
        <h1>首页</h1>
        <p>为艾泽拉斯的每一场战斗，留下完美复盘。<strong>12.0</strong></p>
      </div>
      <div className="topbar-ornament" aria-hidden="true" />
      <div className="topbar-actions">
        <button type="button" className="header-action" disabled><CircleHelp size={17} /><span>帮助文档</span></button>
        <button type="button" className="header-action" disabled><Settings size={17} /><span>设置</span></button>
        <button type="button" className="user-menu" disabled>
          <img src="/assets/user-avatar.png" alt="" /><span>木土猎人</span><ChevronDown size={15} />
        </button>
        <WindowControls />
      </div>
    </header>
  );
}
