import type { PropsWithChildren, ReactNode } from "react";

interface ObsSectionProps extends PropsWithChildren {
  title: ReactNode;
  description?: string;
  extra?: ReactNode;
}

/** 提供 OBS 设置分组统一的扁平面板结构。 */
export function ObsSection({ title, description, extra, children }: ObsSectionProps) {
  return (
    <section className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-surface)]">
      <header className="flex items-start justify-between gap-4 border-b border-[var(--app-border)] px-5 py-4">
        <div>
          <h2 className="m-0 text-base font-semibold">{title}</h2>
          {description && <p className="mb-0 mt-1 text-sm text-[var(--app-text-secondary)]">{description}</p>}
        </div>
        {extra}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
