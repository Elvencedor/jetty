"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { hasNavigatedWithinSite } from "./NavTracker";

/** True when this site sent the shopper here, so going back in history keeps their filters and scroll position. */
const cameFromThisSite = () => window.history.length > 1 && (hasNavigatedWithinSite() || (!!document.referrer && new URL(document.referrer).origin === window.location.origin));

/** Returns a function that goes back in history when this site sent the shopper here, and otherwise to `fallback`. */
export function useGoBack(fallback: string) {
  const router = useRouter();
  return () => (cameFromThisSite() ? router.back() : router.push(fallback));
}

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
        if (cameFromThisSite()) {
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
