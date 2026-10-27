"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Heart } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ProductCard } from "@/components/commerce/ProductCard";
import { BackLink } from "@/components/shell/BackLink";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { getProducts } from "@/lib/api/catalog";
import { useQuote } from "@/lib/cart/useQuote";
import { formatNaira } from "@/lib/format";
import { useStoreHydrated } from "@/lib/stores/hydrated";
import { useCartStore } from "@/lib/stores/cart";
import { BagLine, GiftLine } from "./BagLine";
import { giftLines } from "@/lib/cart/model";
import { CodeEntry } from "./CodeEntry";
import { PriceSummary } from "./PriceSummary";

const UNDO_MS = 5000;

type Removed = { variantId: string; title: string; line: { variantId: string; quantity: number }; index: number };

/** The bag page: lines, offers, totals and the way on to checkout. Every change re-quotes; nothing here prices anything. */
export function Bag() {
  const hydrated = useStoreHydrated(useCartStore);
  const lines = useCartStore((s) => s.lines);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const remove = useCartStore((s) => s.remove);
  const restore = useCartStore((s) => s.restore);
  const { quote, views, busy, error, refetch, ready } = useQuote();
  const [removed, setRemoved] = useState<Removed[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  function onRemove(variantId: string) {
    const title = views.find((v) => v.variantId === variantId)?.priced?.title ?? "Item";
    const taken = remove(variantId);
    if (!taken) return;
    setRemoved((r) => [...r, { variantId, title, ...taken }]);
    timers.current.set(variantId, setTimeout(() => dismiss(variantId), UNDO_MS));
  }
  function dismiss(variantId: string) {
    clearTimeout(timers.current.get(variantId));
    timers.current.delete(variantId);
    setRemoved((r) => r.filter((x) => x.variantId !== variantId));
  }
  function undo(item: Removed) {
    restore(item.line, item.index);
    dismiss(item.variantId);
  }

  const empty = hydrated && !lines.length && !removed.length;
  const count = lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="flex flex-1 flex-col gap-3 bg-surface-tint pb-32">
      <header className="mx-auto flex w-full max-w-xl items-center justify-between px-4 pt-3">
        <BackLink fallback="/shop" />
        <h1 className="font-display text-heading-md font-extrabold">My bag{count ? <> <span className="text-primary">{count}</span></> : null}</h1>
        <Link href="/saved" aria-label="Saved items" className="inline-flex size-11 items-center justify-center rounded-full bg-surface"><Heart aria-hidden="true" size={18} strokeWidth={2} className="text-primary" /></Link>
      </header>

      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4">
        {!hydrated ? <Skeleton className="h-64 w-full" /> : empty ? <EmptyBag /> : (
          <>
            {error ? (
              <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
                <span>We couldn&apos;t update your prices.</span>
                <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              {views.map((v) => <BagLine key={v.variantId} view={v} onQuantity={setQuantity} onRemove={onRemove} busy={busy} />)}
              {giftLines(quote).map((g) => <GiftLine key={`gift-${g.gift?.promotionId}-${g.variantId}`} line={g} />)}
              {removed.map((r) => (
                <div key={r.variantId} role="status" className="flex items-center justify-between gap-3 rounded-card bg-surface px-4 py-3 text-body-sm">
                  <span className="min-w-0 truncate">Removed {r.title}</span>
                  <Button size="sm" variant="soft" onClick={() => undo(r)}>Undo</Button>
                </div>
              ))}
            </div>

            {lines.length ? (
              <>
                <CodeEntry quote={quote} />
                {quote ? <PriceSummary quote={quote} busy={busy} /> : <Skeleton className="h-40 w-full" />}
                <p className="text-center text-caption text-muted">Secure checkout · 7-day returns · Help on WhatsApp</p>
                {/* The total is announced here once it settles; the sticky bar below is not a live region. */}
                <p role="status" className="sr-only">{quote && !busy ? `Total ${formatNaira(quote.totalMinor)}.${quote.discountMinor > 0 ? ` You're saving ${formatNaira(quote.discountMinor)}.` : ""}` : ""}</p>

                <div className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-xl">
                  <div className="flex items-center justify-between gap-2.5 rounded-[34px] bg-surface-inverse py-2.5 pl-5 pr-2.5 text-on-inverse">
                    <p className="flex flex-col leading-tight"><span className="text-caption text-on-inverse-muted">Total</span><span className="font-display text-heading-sm font-extrabold">{quote ? formatNaira(quote.totalMinor) : "…"}</span></p>
                    <Button href={ready ? "/checkout" : undefined} disabled={!ready} aria-disabled={!ready} size="lg" className="h-[52px] px-[22px] text-body" iconRight={<ArrowRight aria-hidden="true" size={18} strokeWidth={2.2} />}>Checkout</Button>
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** An empty bag is an invitation, with a few picks so the next step is one tap away. */
function EmptyBag() {
  const picks = useQuery({ queryKey: ["bag-picks"], queryFn: ({ signal }) => getProducts({ sort: "bestSelling", limit: 4 }, { signal }), staleTime: 5 * 60_000 });
  return (
    <div className="flex flex-col gap-5">
      <EmptyState className="bg-surface" title="Your bag is empty" action={<Button href="/shop">Shop wigs</Button>}>
        Add a wig you love and it will wait for you here.
      </EmptyState>
      {picks.data?.data.length ? (
        <section aria-label="Jetty's picks" className="flex flex-col gap-3">
          <h2 className="font-display text-heading-xs font-extrabold">Jetty&rsquo;s picks</h2>
          <div className="grid grid-cols-2 gap-3">{picks.data.data.map((p, i) => <ProductCard key={p.id} product={p} layout="pick" tone={i} />)}</div>
        </section>
      ) : null}
    </div>
  );
}
