"use client";

import Link from "next/link";
import { Media } from "@/components/ui";
import { PriceSummary } from "@/components/bag/PriceSummary";
import type { DeliveryMethod, PaymentMethod, Quote } from "@/lib/api/types";
import type { DeliveryDetails } from "@/lib/checkout/validation";
import { formatEstimate, formatNaira, formatPhone, normaliseNigerianPhone } from "@/lib/format";

const DELIVERY_LABEL: Record<DeliveryMethod, string> = { same_day: "Same-day delivery", next_day: "Next-day delivery", nationwide: "Nationwide delivery", pickup: "Showroom pickup" };
const PAYMENT_LABEL: Record<PaymentMethod, string> = { card: "Card", bank_transfer: "Bank transfer" };

type Props = {
  quote: Quote | undefined;
  busy: boolean;
  details: DeliveryDetails;
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod;
  terms: boolean;
  termsError?: string | undefined;
  onTerms: (accepted: boolean) => void;
  onEdit: (step: "delivery" | "payment") => void;
};

/** Step 3: everything once more, with the server's total, before money moves. */
export function ReviewStep({ quote, busy, details, deliveryMethod, paymentMethod, terms, termsError, onTerms, onEdit }: Props) {
  const phone = normaliseNigerianPhone(details.phone);
  return (
    <div className="flex flex-col gap-4">
      <h2 data-step-heading tabIndex={-1} className="font-display text-heading-md font-extrabold outline-none">Review your order</h2>

      <ul aria-label="Items" className="flex flex-col gap-3">
        {quote?.lines.map((l) => (
          <li key={l.variantId} className="flex gap-3">
            <Media image={l.image} alt="" aspect="1 / 1.2" sizes="56px" className="w-14 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-body-sm font-bold">{l.title}</p>
              <p className="text-caption text-muted">{[l.optionSummary, `Qty ${l.quantity}`].filter(Boolean).join(" · ")}</p>
            </div>
            <p className="text-body-sm font-bold">{formatNaira(l.lineTotalMinor)}</p>
          </li>
        ))}
      </ul>

      <section aria-label="Delivery" className="flex items-start justify-between gap-3 rounded-lg bg-surface-tint p-3 text-body-sm">
        <div className="min-w-0">
          <p className="font-bold">{DELIVERY_LABEL[deliveryMethod]}{quote?.delivery?.estimate ? ` · ${formatEstimate(quote.delivery.estimate)}` : ""}</p>
          <p className="text-ink-soft">{details.name.trim()}, {[details.addressLine1, details.area, details.city, details.state].map((s) => s.trim()).filter(Boolean).join(", ")}</p>
          <p className="text-ink-soft">{phone ? formatPhone(phone) : details.phone}</p>
        </div>
        <button type="button" onClick={() => onEdit("delivery")} className="shrink-0 text-label font-semibold text-primary-strong underline">Edit<span className="sr-only"> delivery</span></button>
      </section>

      <section aria-label="Payment" className="flex items-center justify-between gap-3 rounded-lg bg-surface-tint p-3 text-body-sm">
        <p className="font-bold">{PAYMENT_LABEL[paymentMethod]}</p>
        <button type="button" onClick={() => onEdit("payment")} className="text-label font-semibold text-primary-strong underline">Edit<span className="sr-only"> payment</span></button>
      </section>

      {quote ? <PriceSummary quote={quote} busy={busy} /> : null}

      <div>
        <label className="flex items-start gap-3 text-body-sm">
          <input id="field-terms" type="checkbox" checked={terms} onChange={(e) => onTerms(e.target.checked)} aria-invalid={termsError ? true : undefined} className="mt-0.5 size-5 shrink-0 accent-primary" />
          <span>I agree to the <Link href="/pages/terms" className="underline">terms</Link> and the <Link href="/pages/returns" className="underline">returns policy</Link>.</span>
        </label>
        {termsError ? <p role="alert" className="mt-1 text-caption font-medium text-danger">{termsError}</p> : null}
      </div>
    </div>
  );
}
