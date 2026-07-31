import { getCurrentWindow } from "@tauri-apps/api/window";
import { Maximize2, Minus, X } from "lucide-react";

type WindowAction = "minimize" | "toggleMaximize" | "close";

/** 在 Tauri 中控制窗口，在普通浏览器预览时保持按钮无副作用。 */
async function runWindowAction(action: WindowAction) {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }

  await getCurrentWindow()[action]();
}

/** 渲染与无边框 Tauri 窗口配套的标题栏控制按钮。 */
export function WindowControls() {
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button
        type="button"
        aria-label="最小化"
        title="最小化"
        onClick={() => void runWindowAction("minimize")}
      >
        <Minus size={17} />
      </button>
      <button
        type="button"
        aria-label="最大化或还原"
        title="最大化或还原"
        onClick={() => void runWindowAction("toggleMaximize")}
      >
        <Maximize2 size={15} />
      </button>
      <button
        className="window-close"
        type="button"
        aria-label="关闭"
        title="关闭"
        onClick={() => void runWindowAction("close")}
      >
        <X size={18} />
      </button>
    </div>
  );
}
