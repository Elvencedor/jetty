"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { Button, Media, QuantityStepper } from "@/components/ui";
import type { LineView } from "@/lib/cart/model";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";
import { API_MAX_LINE_QUANTITY } from "@/lib/stores/cart";

type Props = {
  view: LineView;
  onQuantity: (variantId: string, quantity: number) => void;
  onRemove: (variantId: string) => void;
  busy: boolean;
};

/** One line of the bag. The server's numbers are shown; the stepper changes the client's bag at once and the quote follows. */
export function BagLine({ view, onQuantity, onRemove, busy }: Props) {
  const { priced, problem } = view;
  const title = priced?.title ?? "This item";
  const gone = problem?.kind === "gone";
  const max = Math.min(priced?.availableQuantity ?? API_MAX_LINE_QUANTITY, API_MAX_LINE_QUANTITY);
  const discounted = priced && priced.lineSubtotalMinor > priced.lineTotalMinor;

  return (
    <article aria-label={title} className={cn("relative flex gap-3 rounded-card bg-surface p-2.5", gone && "opacity-70")}>
      <Media image={priced?.image ?? null} alt="" aspect="84 / 100" sizes="84px" className="w-[84px] shrink-0 rounded-md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex justify-between gap-1.5">
          <h2 className="line-clamp-2 text-body-sm font-bold leading-[1.3]">{priced ? <Link href={`/p/${priced.slug}`}>{title}</Link> : title}</h2>
          <button type="button" aria-label={`Remove ${title}`} onClick={() => onRemove(view.variantId)} className="-mr-1.5 -mt-1.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-tint">
            <Trash2 aria-hidden="true" size={16} strokeWidth={2} />
          </button>
        </div>
        {priced?.optionSummary ? <p className="text-caption text-muted">{priced.optionSummary}</p> : null}

        {gone ? (
          <p role="alert" className="text-caption font-semibold text-danger">No longer available. Remove it to continue.</p>
        ) : (
          <>
            {problem?.kind === "short" ? (
              <p role="alert" className="text-caption font-semibold text-warning">
                Only {problem.available} left.{" "}
                <Button variant="ghost-link" size="sm" className="h-auto p-0 text-caption" onClick={() => onQuantity(view.variantId, problem.available)}>Use {problem.available}</Button>
              </p>
            ) : null}
            <div className="mt-auto flex items-center justify-between gap-2">
              <QuantityStepper value={view.quantity} onChange={(q) => onQuantity(view.variantId, q)} max={max} label={title} />
              {priced ? (
                <p aria-busy={busy} className={cn("flex flex-col items-end leading-tight transition-opacity", busy && "opacity-50")}>
                  {discounted ? <s className="text-caption text-muted"><span className="sr-only">Was </span>{formatNaira(priced.lineSubtotalMinor)}</s> : null}
                  <span className="font-display text-heading-xs font-extrabold">{formatNaira(priced.lineTotalMinor)}</span>
                </p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </article>
  );
}
