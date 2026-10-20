"use client";

import { useQueries } from "@tanstack/react-query";
import { ProductCard, ProductCardSkeleton } from "@/components/commerce/ProductCard";
import { Button, EmptyState } from "@/components/ui";
import { isApiError } from "@/lib/api/client";
import { getProduct } from "@/lib/api/catalog";
import type { ProductCard as Card, ProductDetail } from "@/lib/api/types";
import { useSavedSlugs, useWishlistStore } from "@/lib/stores/wishlist";

const SHOWN = 48;

/** The card fields a product's detail can fill in; the wishlist keeps only slugs, so each product is read fresh. */
export function cardFromDetail(p: ProductDetail): Card {
  const prices = p.variants.map((v) => v.price.amountMinor);
  const cover = p.media.find((m) => m.isCover) ?? p.media[0];
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    badge: p.badge,
    badges: [],
    colours: [],
    lengthRange: null,
    featured: p.featured,
    price: { minAmountMinor: Math.min(...prices, Number.MAX_SAFE_INTEGER), maxAmountMinor: Math.max(...prices, 0), currency: "NGN" },
    inStock: p.variants.some((v) => v.availability.inStock),
    onOffer: p.variants.some((v) => v.compareAtPrice && v.compareAtPrice.amountMinor > v.price.amountMinor),
    rating: p.rating,
    image: cover ? { objectKey: cover.objectKey, url: cover.url, altText: cover.altText, width: cover.width, height: cover.height } : null,
  };
}

export function SavedList() {
  const { slugs, hydrated } = useSavedSlugs();
  const remove = useWishlistStore((s) => s.remove);
  const shown = slugs.slice(0, SHOWN);
  const results = useQueries({
    queries: shown.map((slug) => ({
      queryKey: ["product", slug],
      queryFn: ({ signal }: { signal: AbortSignal }) => getProduct(slug, { signal }),
      staleTime: 5 * 60_000,
      retry: (count: number, err: unknown) => !(isApiError(err) && err.status === 404) && count < 1,
    })),
  });

  if (!hydrated) return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>;
  if (!slugs.length) {
    return (
      <EmptyState title="Nothing saved yet" action={<Button href="/shop">Browse wigs</Button>}>
        Tap the heart on a wig to keep it here. Saved wigs stay on this device.
      </EmptyState>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 lg:grid-cols-4">
      {results.map((r, i) => {
        const slug = shown[i]!;
        if (r.isPending) return <ProductCardSkeleton key={slug} />;
        if (r.data) return <ProductCard key={slug} product={cardFromDetail(r.data)} tone={i} heading="h2" />;
        // Gone from the catalogue (404) or failing: let the shopper drop it instead of leaving a dead tile.
        return (
          <div key={slug} className="flex flex-col items-start gap-2 rounded-card border border-line p-3 text-body-sm">
            <p className="text-muted">{isApiError(r.error) && r.error.status === 404 ? "This wig is no longer available." : "Couldn't load this wig."}</p>
            <Button size="sm" variant="outline" onClick={() => remove(slug)}>Remove</Button>
          </div>
        );
      })}
    </div>
  );
}
