"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Heart, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, QuantityStepper } from "@/components/ui";
import { getQuote } from "@/lib/api/pricing";
import type { ProductDetail } from "@/lib/api/types";
import { track } from "@/lib/analytics";
import { initialSelection, priceRange, resolveVariant, type Selection } from "@/lib/catalog/variants";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";
import { API_MAX_LINE_QUANTITY, useCartStore } from "@/lib/stores/cart";
import { useIsSaved, useWishlistStore } from "@/lib/stores/wishlist";
import { DeliveryEstimate } from "./DeliveryEstimate";
import { Gallery } from "./Gallery";
import { OptionPicker } from "./OptionPicker";

type Props = {
  product: ProductDetail;
  /** Server-rendered sections shown below the options (tabs, reviews). */
  children?: ReactNode;
};

/** The product page's interactive core: photos, option choices, live price, wishlist, share and the add-to-bag bar. */
export function ProductView({ product, children }: Props) {
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product));
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState<number | null>(null);
  const add = useCartStore((s) => s.add);
  const saved = useIsSaved(product.slug);
  const toggleSaved = useWishlistStore((s) => s.toggle);

  const variant = useMemo(() => resolveVariant(product, selection), [product, selection]);
  const buyable = !!variant?.availability.inStock;
  const max = Math.min(variant?.availability.availableQuantity ?? 1, API_MAX_LINE_QUANTITY);

  useEffect(() => {
    track("product_view", { productId: product.id });
  }, [product.id]);

  // The shown price is the server's quote for this variant, so it agrees with the bag and checkout.
  const { data: quote } = useQuery({
    queryKey: ["pdp-quote", variant?.id, quantity],
    queryFn: ({ signal }) => getQuote({ items: [{ variantId: variant!.id, quantity }], promotionCodes: [] }, { signal }),
    enabled: !!variant,
    staleTime: 60_000,
    retry: 1,
  });
  const line = quote?.lines[0];
  const unit = line?.unitPriceMinor ?? variant?.price.amountMinor;
  const compareAt = line?.compareAtPriceMinor ?? variant?.compareAtPrice?.amountMinor ?? null;
  const range = priceRange(product.variants);
  const total = quote?.totalMinor;

  const setQty = (n: number) => setQuantity(Math.min(Math.max(n, 1), Math.max(max, 1)));
  const onAdd = () => {
    if (!variant || !buyable) return;
    add(variant.id, quantity);
    track("add_to_bag", { productId: product.id, variantId: variant.id, quantity });
    setAdded(quantity);
  };

  const onShare = async () => {
    const data = { title: product.title, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(data.url);
    } catch {
      // Cancelled share sheet or blocked clipboard: nothing to report.
    }
  };

  const status = !variant ? "Choose your options" : !buyable ? "Sold out" : variant.availability.lowStock ? `Only ${variant.availability.availableQuantity} left` : "In stock";

  return (
    <div className="grid gap-6 pb-28 lg:grid-cols-2 lg:gap-10 lg:pb-8">
      <Gallery media={product.media} title={product.title} focusId={product.media.find((m) => m.variantId === variant?.id)?.id} />

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-heading-lg font-extrabold">{product.title}</h1>
            <div className="flex shrink-0 gap-1">
              <button type="button" aria-pressed={saved} aria-label={`Save ${product.title}`} onClick={() => toggleSaved(product.slug)} className="inline-flex size-11 items-center justify-center rounded-full bg-surface-tint">
                <Heart aria-hidden="true" size={20} className={cn(saved && "fill-primary text-primary")} />
              </button>
              <button type="button" aria-label="Share" onClick={onShare} className="inline-flex size-11 items-center justify-center rounded-full bg-surface-tint">
                <Share2 aria-hidden="true" size={20} />
              </button>
            </div>
          </div>
          {product.rating.count ? (
            <a href="#reviews" className="text-body-sm font-semibold text-ink-soft">★ {product.rating.average.toFixed(1)} · {product.rating.count} {product.rating.count === 1 ? "review" : "reviews"}</a>
          ) : null}
          <p className="flex items-baseline gap-2" aria-live="polite">
            {unit !== undefined ? (
              <>
                <span className="font-display text-heading-lg font-extrabold">{formatNaira(unit)}</span>
                {compareAt && compareAt > unit ? <s className="text-body text-muted"><span className="sr-only">Was </span>{formatNaira(compareAt)}</s> : null}
              </>
            ) : range ? (
              <span className="font-display text-heading-lg font-extrabold">{range.min === range.max ? formatNaira(range.min) : `From ${formatNaira(range.min)}`}</span>
            ) : null}
          </p>
          <p className={cn("text-body-sm font-semibold", buyable ? (variant?.availability.lowStock ? "text-warning" : "text-success") : "text-muted")}>{status}</p>
        </div>

        <OptionPicker product={product} selection={selection} onChange={(next) => { setSelection(next); setAdded(null); setQuantity(1); }} />
        <DeliveryEstimate variantId={variant?.id} />
        {children}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] max-lg:bottom-14 lg:static lg:col-start-2 lg:border-0 lg:pb-0">
        <div className="mx-auto flex max-w-store flex-col gap-2 px-4 py-3 lg:px-0 lg:py-0">
          {added ? (
            <p role="status" className="flex items-center gap-2 text-body-sm font-semibold text-success">
              <Check aria-hidden="true" size={16} /> Added {added > 1 ? `${added} to` : "to"} your bag. <Link href="/bag" className="underline">View bag</Link>
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <QuantityStepper value={quantity} onChange={setQty} max={buyable ? max : 1} disabled={!buyable} />
            <Button size="lg" fullWidth disabled={!buyable} onClick={onAdd}>
              {!variant ? "Choose options" : !buyable ? "Sold out" : total !== undefined ? `Add to bag · ${formatNaira(total)}` : "Add to bag"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
