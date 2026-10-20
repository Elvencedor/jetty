"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useCartCount } from "@/lib/stores/cart";

/** The bag icon with the number of items in it. */
export function BagLink() {
  const count = useCartCount();
  const shown = count > 99 ? "99+" : String(count);
  return (
    <Link href="/bag" aria-label={count ? `Bag, ${shown} ${count === 1 ? "item" : "items"}` : "Bag"} className="relative inline-flex size-11 items-center justify-center rounded-full bg-surface-tint text-ink transition-colors hover:bg-surface-blush">
      <ShoppingBag aria-hidden="true" size={20} />
      {count ? (
        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-micro font-bold text-on-primary ring-2 ring-white">
          {shown}
        </span>
      ) : null}
    </Link>
  );
}
