"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * A 44px round back button. It goes back in history when this site sent the shopper here (so filters and scroll
 * position survive), and otherwise to `fallback`, so a shared link still leads somewhere sensible.
 */
export function BackLink({ fallback, label = "Back", className }: { fallback: string; label?: string; className?: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallback}
      aria-label={label}
      onClick={(e) => {
        const cameFromHere = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
        if (cameFromHere && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-ink", className)}
    >
      <ChevronLeft aria-hidden="true" size={20} strokeWidth={2} />
    </Link>
  );
}
