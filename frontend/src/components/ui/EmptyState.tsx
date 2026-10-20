import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Dashed card for "nothing here": a title, one line of help, and at most one action. */
export function EmptyState({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 rounded-card border-[1.5px] border-dashed border-line-accent px-6 py-10 text-center", className)}>
      <h2 className="font-display text-heading-sm font-extrabold text-ink">{title}</h2>
      {children ? <p className="max-w-sm text-body text-muted">{children}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
