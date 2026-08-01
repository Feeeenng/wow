import { Empty } from "antd";

interface SettingsPlaceholderProps {
  title: string;
}

/** 展示尚未进入当前实现范围的设置分类。 */
export function SettingsPlaceholder({ title }: SettingsPlaceholderProps) {
  return (
    <div className="flex min-h-[540px] items-center justify-center border border-[var(--app-border)] bg-[var(--app-surface)]">
      <Empty description={`${title}将在对应功能开发时补充`} />
    </div>
  );
}
