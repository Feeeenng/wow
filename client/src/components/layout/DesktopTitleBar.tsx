import type { MouseEvent } from "react";
import { QuestionCircleOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Tooltip } from "antd";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WindowControls } from "@/components/layout/WindowControls";

interface DesktopTitleBarProps {
  title: string;
}

/** 展示页面标题、用户入口和桌面窗口控制。 */
export function DesktopTitleBar({ title }: DesktopTitleBarProps) {
  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !('__TAURI_INTERNALS__' in window)) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, [role='button']")) {
      return;
    }
    void getCurrentWindow().startDragging();
  };

  return (
    <header
      className="flex h-16 shrink-0 items-center border-b border-[var(--app-border)] bg-[var(--app-surface)] px-6"
      onMouseDown={startWindowDrag}
    >
      <div className="min-w-0 flex-1">
        <h1 className="m-0 truncate text-xl font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        <Tooltip title="帮助文档">
          <Button type="text" icon={<QuestionCircleOutlined />} aria-label="帮助文档" />
        </Tooltip>
        <Button type="text" icon={<UserOutlined />}>木土猎人</Button>
        <WindowControls />
      </div>
    </header>
  );
}
