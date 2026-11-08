"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Heart, Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackLink, useGoBack } from "@/components/shell/BackLink";
import { useDebounced } from "@/components/shell/useDebounced";
import { Badge, Button, Media, QuantityStepper } from "@/components/ui";
import { track } from "@/lib/analytics";
import { getQuote } from "@/lib/api/pricing";
import type { ProductDetail } from "@/lib/api/types";
import { initialSelection, priceRange, resolveVariant, type Selection } from "@/lib/catalog/variants";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";
import { useCartStore } from "@/lib/stores/cart";
import { useIsSaved, useWishlistStore } from "@/lib/stores/wishlist";
import { DeliveryEstimate, soonest, useDeliveryOptions } from "./DeliveryEstimate";
import { Gallery } from "./Gallery";
import { OptionPicker } from "./OptionPicker";

/** Per-line limit on the product page (a business rule from the design). */
const MAX_QUANTITY = 5;
/** How long "Added" shows on the button before the shopper is taken back to where they were browsing. */
const ADDED_MS = 700;
const QUOTE_DEBOUNCE_MS = 150;

const soldLabel = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
const circleButton = "inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink shadow-md lg:shadow-none";

type Props = {
  product: ProductDetail;
  /** Server-rendered sections shown below the options (tabs, reviews). */
  children?: ReactNode;
};

/** The product page's interactive core: photos, option choices, live price, wishlist, share and the add-to-bag bar. */
export function ProductView({ product, children }: Props) {
  const [selection, setSelection] = useState<Selection>(() => initialSelection(product));
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const goBack = useGoBack("/shop");
  const [state, setState] = useState("Lagos");
  const addedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const add = useCartStore((s) => s.add);
  const saved = useIsSaved(product.slug);
  const toggleSaved = useWishlistStore((s) => s.toggle);

  const variant = useMemo(() => resolveVariant(product, selection), [product, selection]);
  const buyable = !!variant?.availability.inStock;
  const max = Math.max(Math.min(variant?.availability.availableQuantity ?? 1, MAX_QUANTITY), 1);

  useEffect(() => {
    track("product_view", { productId: product.id });
  }, [product.id]);
  useEffect(() => () => clearTimeout(addedTimer.current), []);

  // The shown price is the server's quote for this variant, so it agrees with the bag and checkout. A quick run of
  // changes asks once, and the number dims while the answer is on its way.
  const wanted = { variantId: variant?.id, quantity };
  const settled = useDebounced(wanted, QUOTE_DEBOUNCE_MS);
  const { data: quote, isFetching } = useQuery({
    queryKey: ["pdp-quote", settled.variantId, settled.quantity],
    queryFn: ({ signal }) => getQuote({ items: [{ variantId: settled.variantId!, quantity: settled.quantity }], promotionCodes: [] }, { signal }),
    enabled: !!settled.variantId,
    staleTime: 60_000,
    retry: 1,
  });
  const waiting = isFetching || settled.variantId !== wanted.variantId || settled.quantity !== wanted.quantity;
  const line = quote?.lines.find((l) => l.variantId === variant?.id) ?? quote?.lines[0];
  const unit = line?.unitPriceMinor ?? variant?.price.amountMinor;
  const compareAt = line?.compareAtPriceMinor ?? variant?.compareAtPrice?.amountMinor ?? null;
  const range = priceRange(product.variants);
  const lineTotal = quantity === 1 ? unit : line?.lineTotalMinor;

  const delivery = useDeliveryOptions(variant?.id, state);
  const sameDay = delivery.data?.options.some((o) => o.method === "same_day" && o.available && o.estimate?.earliestDate === soonest(delivery.data?.options ?? [])?.estimate?.earliestDate);
  const salePct = unit !== undefined && compareAt && compareAt > unit ? Math.round(((compareAt - unit) * 100) / compareAt) : null;
  const cover = product.media.find((m) => m.variantId === variant?.id) ?? product.media[0] ?? null;
  const category = product.categories[0];
  const summary = product.options.map((o) => o.values.find((v) => v.id === selection[o.id])?.label).filter(Boolean).join(" · ");

  const select = (next: Selection) => {
    setSelection(next);
    setAdded(false);
    setQuantity(1);
  };
  const onAdd = () => {
    if (!variant || !buyable || added) return;
    add(variant.id, quantity);
    track("add_to_bag", { productId: product.id, variantId: variant.id, quantity });
    // Confirm on the button, then return to the listing; the bag count in the header has gone up by the time they are there.
    setAdded(true);
    clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(goBack, ADDED_MS);
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

  const actions = (
    <>
      <button type="button" aria-label="Share" onClick={onShare} className={circleButton}><Share2 aria-hidden="true" size={18} strokeWidth={2} /></button>
      <button type="button" aria-pressed={saved} aria-label={`Save ${product.title}`} onClick={() => toggleSaved(product.slug)} className={circleButton}>
        <Heart aria-hidden="true" size={18} strokeWidth={2} className={cn("text-primary", saved && "fill-primary")} />
      </button>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-store pb-24 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10 lg:gap-y-4 lg:px-4 lg:pb-28 lg:pt-4">
      {/* Wide screens: a way back and where this page sits, above the photos and details. */}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-3 lg:col-span-2 lg:row-start-1 lg:flex">
        <BackLink fallback="/shop" className="border border-line bg-surface-tint" />
        <ol className="flex min-w-0 items-center gap-1.5 text-label text-muted">
          <li><Link href="/">Home</Link></li>
          <li aria-hidden="true">›</li>
          <li><Link href="/shop">Wigs</Link></li>
          {category ? <><li aria-hidden="true">›</li><li><Link href={`/shop/${category.slug}`}>{category.name}</Link></li></> : null}
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="truncate font-semibold text-ink">{product.title}</li>
        </ol>
      </nav>

      {/* Phones: back, share and save float over the photo and stay at the top of the screen while the page scrolls (zero height, so they take no room). Wide screens: share and save sit on the photo. */}
      <div className="pointer-events-none sticky top-3 z-30 h-0 lg:relative lg:top-auto lg:col-start-1 lg:row-start-2">
        <div className="flex justify-between px-4 lg:justify-end">
          <BackLink fallback="/shop" className="pointer-events-auto shadow-md lg:hidden" />
          <div className="pointer-events-auto flex gap-2">{actions}</div>
        </div>
      </div>

      <div className="lg:col-start-1 lg:row-start-2">
        <Gallery media={product.media} title={product.title} focusId={product.media.find((m) => m.variantId === variant?.id)?.id} />
      </div>

      <div className="relative -mt-8 flex flex-col gap-4 rounded-t-[32px] bg-surface px-4 pb-8 pt-[22px] lg:col-start-2 lg:row-start-2 lg:mt-0 lg:rounded-none lg:px-0 lg:pt-0">
        {salePct || quote?.promotions.applied.length || sameDay ? (
          <div className="flex flex-wrap gap-1.5">
            {salePct ? <Badge kind="sale" className="px-2.5 py-1 text-caption">−{salePct}% today</Badge> : null}
            {quote?.promotions.applied.map((p) => <Badge key={p.promotionId} kind="eligible" className="px-2.5 py-1 text-caption">{p.name}</Badge>)}
            {sameDay ? <Badge kind="eligible" className="px-2.5 py-1 text-caption">Same-day {state}</Badge> : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <h1 className="line-clamp-3 font-display text-heading-lg font-extrabold">{product.title}</h1>
          {product.rating.count ? (
            <a href="#reviews" className="flex items-center gap-2 text-body-sm text-ink">
              <span className="rounded-xs bg-surface-inverse px-2 py-0.5 font-bold text-on-inverse">★ {product.rating.average.toFixed(1)}</span>
              <span className="underline">{product.rating.count} {product.rating.count === 1 ? "review" : "reviews"}</span>
              {product.soldCount > 0 ? <span className="text-muted">· {soldLabel(product.soldCount)} sold</span> : null}
            </a>
          ) : null}
        </div>

        <section aria-label="Your wig" className="flex items-center justify-between gap-2.5 rounded-lg bg-surface-tint p-3.5">
          <p className="flex min-w-0 flex-col leading-[1.3]">
            <span className="text-caption font-bold tracking-[0.5px] text-primary-strong">YOUR WIG</span>
            <span className="text-body-sm font-semibold">{!variant && product.options.length ? "Choose your options" : summary || product.title}</span>
          </p>
          <p aria-live="polite" aria-busy={waiting} className={cn("flex shrink-0 flex-col items-end leading-tight transition-opacity", waiting && "opacity-50")}>
            {variant && !buyable ? (
              <span className="font-display text-heading-xs font-extrabold text-muted">Sold out</span>
            ) : unit !== undefined ? (
              <>
                {compareAt && compareAt > unit ? <s className="text-caption text-muted"><span className="sr-only">Was </span>{formatNaira(compareAt)}</s> : null}
                <span className="font-display text-heading-sm font-extrabold">{formatNaira(unit)}</span>
              </>
            ) : range ? (
              <span className="font-display text-heading-sm font-extrabold">{range.min === range.max ? formatNaira(range.min) : `From ${formatNaira(range.min)}`}</span>
            ) : null}
          </p>
        </section>
        {variant?.availability.lowStock && buyable ? <p className="-mt-2 text-label font-semibold text-warning">Only {variant.availability.availableQuantity} left</p> : null}

        <OptionPicker product={product} selection={selection} onChange={select} />
        <DeliveryEstimate variantId={variant?.id} state={state} onState={setState} />
        {children}
      </div>

      {/* Pinned to the bottom of the screen at every size, so buying is never further than a glance however long the page is. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <div className="mx-auto flex w-full max-w-store flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
              <Media image={cover} alt="" aspect="1 / 1" sizes="56px" className="size-14 shrink-0 !rounded-md" />
              <p className="flex min-w-0 flex-col leading-tight">
                <span className="truncate font-bold">{product.title}</span>
                <span className="truncate text-body-sm text-muted">{summary || "Choose your options"}</span>
              </p>
              {unit !== undefined && buyable ? (
                <p aria-hidden="true" className={cn("ml-auto flex shrink-0 flex-col items-end leading-tight transition-opacity", waiting && "opacity-50")}>
                  {compareAt && compareAt > unit ? <s className="text-caption text-muted">{formatNaira(compareAt)}</s> : null}
                  <span className="font-display text-heading-xs font-extrabold">{formatNaira(unit)}</span>
                </p>
              ) : null}
            </div>
            <QuantityStepper value={quantity} onChange={(q) => setQuantity(Math.min(Math.max(q, 1), max))} max={buyable ? max : 1} disabled={!buyable} className="[&_button]:h-[52px]" />
            <Button size="lg" disabled={!buyable} onClick={onAdd} className="h-[54px] min-w-0 flex-1 lg:w-72 lg:flex-none">
              <span role="status" className="sr-only">{added ? "Added to bag" : ""}</span>
              {added ? <><Check aria-hidden="true" size={18} strokeWidth={2.4} /> Added to bag</> : !variant ? "Choose options" : !buyable ? "Sold out" : lineTotal !== undefined ? `Add to bag · ${formatNaira(lineTotal)}` : "Add to bag"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
