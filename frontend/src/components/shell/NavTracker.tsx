"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

let navigations = 0;
let lastPath: string | null = null;

/** True once the shopper has moved between pages inside the site since it loaded, so going back stays on the site. */
export const hasNavigatedWithinSite = () => navigations > 0;

/**
 * Counts in-site page changes. `document.referrer` only describes the first page load, so it cannot tell that a shopper
 * who landed on a listing and then opened a product has somewhere to go back to; this can.
 */
export function NavTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (lastPath !== null && lastPath !== pathname) navigations += 1;
    lastPath = pathname;
  }, [pathname]);
  return null;
}
