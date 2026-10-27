import type { Quote } from "@/lib/api/types";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/format";

/** The parts of a quote (or of a placed order) the summary needs. */
export type SummaryData = Pick<Quote, "subtotalMinor" | "discountMinor" | "deliveryFeeMinor" | "taxMinor" | "totalMinor" | "delivery"> & { promotions: Pick<Quote["promotions"], "applied"> };

type Props = {
  quote: SummaryData;
  busy: boolean;
  deliveryNote?: string;
  /** `bordered` is the checkout review's look (outlined, no fill); the default is the bag's white card. */
  bordered?: boolean;
};

/** Totals exactly as the server calculated them; the client adds nothing up. Dimmed and busy while a new answer loads. */
export function PriceSummary({ quote, busy, deliveryNote = "Calculated at checkout", bordered = false }: Props) {
  const free = quote.delivery && quote.deliveryFeeMinor === 0;
  return (
    <section aria-label="Order summary" aria-busy={busy} className={cn("flex flex-col gap-2 rounded-card p-4 text-body-sm", bordered ? "border-[1.5px] border-line bg-surface" : "bg-surface")}>
      <dl className={cn("flex flex-col gap-2 transition-opacity", busy && "opacity-50")}>
        <Row label="Items" value={formatNaira(quote.subtotalMinor)} />
        {quote.promotions.applied.map((p) => (
          <Row key={p.promotionId} label={p.code ? `${p.name} (${p.code})` : p.name} value={`−${formatNaira(p.discountMinor)}`} tone="success" />
        ))}
        <Row label="Delivery" value={quote.delivery ? (free ? "Free" : formatNaira(quote.deliveryFeeMinor)) : deliveryNote} />
        {quote.taxMinor > 0 ? <Row label="Tax" value={formatNaira(quote.taxMinor)} /> : null}
        <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
          <dt className="font-display text-body-lg font-extrabold">Total</dt>
          <dd className="font-display text-heading-xs font-extrabold">{formatNaira(quote.totalMinor)}</dd>
        </div>
      </dl>
      {quote.discountMinor > 0 ? <p className="mt-1 rounded-[14px] bg-success-bg px-3 py-2.5 text-center font-bold text-success">You&rsquo;re saving {formatNaira(quote.discountMinor)}</p> : null}
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className={cn("flex justify-between gap-3", tone === "success" && "font-semibold text-success")}>
      <dt>{label}</dt>
      <dd className="shrink-0">{value}</dd>
    </div>
  );
}
