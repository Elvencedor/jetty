import { cn } from "@/lib/cn";

/** Loading placeholder. Hidden from assistive technology; the region around it should set `aria-busy`. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-surface-blush/70", className)} />;
}
