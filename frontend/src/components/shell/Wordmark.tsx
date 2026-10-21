import Link from "next/link";
import { cn } from "@/lib/cn";

/** The brand mark: a pink "J" tile and the lower-case wordmark. */
export function Wordmark({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <Link href="/" className={cn("flex shrink-0 items-center gap-2", className)}>
      <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-sm bg-primary font-display text-heading-xs font-extrabold text-on-primary">J</span>
      <span className={cn("font-display text-heading-sm font-extrabold tracking-[-0.5px]", textClassName)}>jetty&rsquo;s hair</span>
    </Link>
  );
}
