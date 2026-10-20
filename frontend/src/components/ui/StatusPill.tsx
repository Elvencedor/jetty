import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type StatusTone = "warning" | "primary" | "blush" | "info" | "success" | "danger" | "neutral" | "ink";

const TONES: Record<StatusTone, string> = {
  warning: "bg-warning-bg text-warning",
  primary: "bg-primary text-on-primary",
  blush: "bg-surface-blush text-primary-strong",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-neutral-bg text-muted",
  ink: "bg-surface-inverse text-on-inverse",
};

/** Status label with a semantic colour. The text always says the status; colour only reinforces it. */
export function StatusPill({ tone, children, className }: { tone: StatusTone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-pill px-3 py-1 text-caption font-bold", TONES[tone], className)}>{children}</span>;
}
