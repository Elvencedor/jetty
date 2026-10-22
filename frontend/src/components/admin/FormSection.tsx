import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A card that groups related fields under a title, the building block of settings and editor screens. */
export function FormSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-4 rounded-card border border-line bg-surface p-5", className)}>
      <div>
        <h2 className="font-display text-heading-xs font-extrabold">{title}</h2>
        {description ? <p className="text-body-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
