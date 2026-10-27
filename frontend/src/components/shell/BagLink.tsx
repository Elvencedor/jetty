"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { useCartCount } from "@/lib/stores/cart";

/**
 * The bag icon with the number of items in it. `ring` is the colour of the 2px ring around the count, which should
 * match what the button sits on (white, or the pink header block).
 */
export function BagLink({ className, ring = "ring-white" }: { className?: string; ring?: string }) {
  const count = useCartCount();
  const shown = count > 99 ? "99+" : String(count);
  return (
    <Link href="/bag" aria-label={count ? `Bag, ${shown} ${count === 1 ? "item" : "items"}` : "Bag"} className={cn("relative inline-flex size-11 items-center justify-center rounded-full bg-surface-tint text-ink transition-colors hover:bg-surface-blush", className)}>
      <ShoppingBag aria-hidden="true" size={20} strokeWidth={1.8} />
      {count ? (
        <span aria-hidden="true" className={cn("absolute right-0.5 top-0.5 flex size-[18px] items-center justify-center rounded-full bg-primary text-micro font-bold text-on-primary ring-2", ring)}>
          {shown}
        </span>
      ) : null}
    </Link>
  );
}
