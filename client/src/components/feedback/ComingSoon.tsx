import { Empty } from "antd";

interface ComingSoonProps {
  title: string;
  description: string;
}

/** 为尚未进入本轮开发范围的一级页面提供一致空状态。 */
export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <section className="mx-auto flex min-h-[520px] max-w-[1440px] items-center justify-center border border-[var(--app-border)] bg-[var(--app-surface)]">
      <Empty description={<div><strong className="block text-base">{title}</strong><span className="mt-1 block text-sm text-[var(--app-text-secondary)]">{description}</span></div>} />
    </section>
  );
}
