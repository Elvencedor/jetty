"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsSaved, useWishlistStore } from "@/lib/stores/wishlist";

/** Heart toggle for the local wishlist. A 44px target with a smaller visual, so it is easy to tap on a card. */
export function WishlistButton({ slug, title, className }: { slug: string; title: string; className?: string }) {
  const saved = useIsSaved(slug);
  const toggle = useWishlistStore((s) => s.toggle);
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={`Save ${title}`}
      onClick={() => toggle(slug)}
      className={cn("z-10 inline-flex size-11 items-center justify-center", className)}
    >
      <span className="flex size-[30px] items-center justify-center rounded-full bg-white shadow-sm">
        <Heart aria-hidden="true" size={16} className={cn(saved ? "fill-primary text-primary" : "text-ink")} />
      </span>
    </button>
  );
}
