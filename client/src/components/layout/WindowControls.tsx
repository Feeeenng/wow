import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, X } from "lucide-react";

const withDesktopWindow = async (action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>) => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  await action(getCurrentWindow());
};

/** 提供无边框 Tauri 窗口的最小化、最大化和关闭控制。 */
export function WindowControls() {
  return (
    <div className="window-controls">
      <button type="button" title="最小化" onClick={() => withDesktopWindow((appWindow) => appWindow.minimize())}><Minus size={16} /></button>
      <button type="button" title="最大化" onClick={() => withDesktopWindow((appWindow) => appWindow.toggleMaximize())}><Maximize2 size={14} /></button>
      <button type="button" title="关闭" className="window-close" onClick={() => withDesktopWindow((appWindow) => appWindow.close())}><X size={17} /></button>
    </div>
  );
}
