import type { Quote } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";

/** Totals exactly as the server calculated them; the client adds nothing up. Dimmed and busy while a new answer loads. */
export function PriceSummary({ quote, busy, deliveryNote = "Calculated at checkout" }: { quote: Quote; busy: boolean; deliveryNote?: string }) {
  const free = quote.delivery && quote.deliveryFeeMinor === 0;
  return (
    <section aria-label="Order summary" aria-busy={busy} className="flex flex-col gap-3 rounded-lg bg-surface p-4">
      {quote.discountMinor > 0 ? (
        <p className="rounded-md bg-success-bg px-3 py-2 text-body-sm font-bold text-success">You&rsquo;re saving {formatNaira(quote.discountMinor)}</p>
      ) : null}
      <dl className={cn("flex flex-col gap-2 text-body-sm", busy && "opacity-50")}>
        <Row label="Items" value={formatNaira(quote.subtotalMinor)} />
        {quote.promotions.applied.map((p) => (
          <Row key={p.promotionId} label={p.code ? `${p.name} (${p.code})` : p.name} value={`−${formatNaira(p.discountMinor)}`} tone="success" />
        ))}
        <Row label="Delivery" value={quote.delivery ? (free ? "Free" : formatNaira(quote.deliveryFeeMinor)) : deliveryNote} />
        {quote.taxMinor > 0 ? <Row label="Tax" value={formatNaira(quote.taxMinor)} /> : null}
        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
          <dt className="text-body font-bold">Total</dt>
          <dd className="font-display text-heading-sm font-extrabold">{formatNaira(quote.totalMinor)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={cn("text-ink-soft", tone === "success" && "text-success")}>{label}</dt>
      <dd className={cn("shrink-0 font-semibold", tone === "success" && "text-success")}>{value}</dd>
    </div>
  );
}
