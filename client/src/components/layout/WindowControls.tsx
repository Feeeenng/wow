import { BorderOutlined, CloseOutlined, MinusOutlined } from "@ant-design/icons";
import { getCurrentWindow } from "@tauri-apps/api/window";

const withDesktopWindow = async (
  action: (currentWindow: ReturnType<typeof getCurrentWindow>) => Promise<void>,
) => {
  if (!("__TAURI_INTERNALS__" in window)) {
    return;
  }
  await action(getCurrentWindow());
};

/** 提供无边框 Tauri 窗口的最小化、最大化和关闭控制。 */
export function WindowControls() {
  return (
    <div className="ml-2 flex items-center">
      <button
        type="button"
        className="h-9 w-10 text-[var(--app-text-secondary)] hover:bg-gray-100"
        title="最小化"
        onClick={() => withDesktopWindow((currentWindow) => currentWindow.minimize())}
      >
        <MinusOutlined />
      </button>
      <button
        type="button"
        className="h-9 w-10 text-[var(--app-text-secondary)] hover:bg-gray-100"
        title="最大化"
        onClick={() => withDesktopWindow((currentWindow) => currentWindow.toggleMaximize())}
      >
        <BorderOutlined />
      </button>
      <button
        type="button"
        className="h-9 w-10 text-[var(--app-text-secondary)] hover:bg-red-500 hover:text-white"
        title="关闭"
        onClick={() => withDesktopWindow((currentWindow) => currentWindow.close())}
      >
        <CloseOutlined />
      </button>
    </div>
  );
}
