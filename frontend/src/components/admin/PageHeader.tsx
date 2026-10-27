import type { ReactNode } from "react";

/** Title and one-line subtitle on the left, the page's actions on the right (wrapping on narrow screens). */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        {subtitle ? <p className="text-body-sm text-muted">{subtitle}</p> : null}
        <h1 className="font-display text-display-md font-extrabold">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
