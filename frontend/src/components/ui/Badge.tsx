import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeKind = "sale" | "bogo" | "highlight" | "gift" | "free-line" | "eligible";

const KINDS: Record<BadgeKind, string> = {
  sale: "bg-primary text-on-primary",
  bogo: "bg-surface-inverse text-on-inverse",
  /** new, featured, low stock */
  highlight: "bg-white text-primary-strong",
  gift: "bg-surface-inverse text-on-inverse",
  "free-line": "bg-primary text-on-primary",
  eligible: "bg-surface-tint text-primary-strong",
};

/** Maps the API's computed badge kinds onto visual styles. */
export const BADGE_KIND_FOR: Record<string, BadgeKind> = { sale: "sale", new: "highlight", low_stock: "highlight", featured: "highlight", custom: "highlight" };

export function Badge({ kind = "highlight", children, className }: { kind?: BadgeKind; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-xs px-2.5 py-0.5 text-micro font-bold", KINDS[kind], className)}>{children}</span>;
}
