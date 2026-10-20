"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { useQuote } from "@/lib/cart/useQuote";
import { formatNaira } from "@/lib/format";
import { useStoreHydrated } from "@/lib/stores/hydrated";
import { useCartStore } from "@/lib/stores/cart";
import { BagLine } from "./BagLine";
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

  if (!hydrated) return <Skeleton className="h-64 w-full" />;
  if (!lines.length && !removed.length) {
    return (
      <EmptyState title="Your bag is empty" action={<Button href="/shop">Shop wigs</Button>}>
        Add a wig you love and it will wait for you here.
      </EmptyState>
    );
  }

  const count = lines.reduce((n, l) => n + l.quantity, 0);
  return (
    <div className="flex flex-col gap-4 pb-28">
      <h1 className="font-display text-heading-lg font-extrabold">My bag <span className="text-primary">{count}</span></h1>

      {error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger-bg p-3 text-body-sm text-danger">
          <span>We couldn&apos;t update your prices.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {views.map((v) => <BagLine key={v.variantId} view={v} onQuantity={setQuantity} onRemove={onRemove} busy={busy} />)}
        {removed.map((r) => (
          <div key={r.variantId} role="status" className="flex items-center justify-between gap-3 rounded-lg bg-surface-tint px-4 py-3 text-body-sm">
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

          <div className="fixed inset-x-0 bottom-14 z-20 px-3 pb-[env(safe-area-inset-bottom)] lg:static lg:bottom-auto lg:px-0 lg:pb-0">
            <div className="mx-auto flex max-w-store items-center justify-between gap-3 rounded-pill bg-surface-inverse py-2 pl-5 pr-2 text-on-inverse shadow-panel">
              <p className="text-body-sm"><span className="text-on-inverse-muted">Total </span><span className="font-display text-body font-extrabold">{quote ? formatNaira(quote.totalMinor) : "…"}</span></p>
              {ready ? (
                <Button href="/checkout" size="md" iconRight={<ArrowRight aria-hidden="true" size={18} />}>Checkout</Button>
              ) : (
                <Button size="md" disabled iconRight={<ArrowRight aria-hidden="true" size={18} />}>Checkout</Button>
              )}
            </div>
          </div>
        </>
      ) : (
        <Link href="/shop" className="self-center text-label font-semibold text-primary-strong">Continue shopping</Link>
      )}
    </div>
  );
}
