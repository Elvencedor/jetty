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
  onEdit: (step: "delivery" | "payment") => void;
};

function EditRow({ label, children, onEdit, name }: { label: string; children: React.ReactNode; onEdit: () => void; name: string }) {
  return (
    <section aria-label={label} className="flex justify-between gap-2.5 rounded-lg border-[1.5px] border-line p-3.5 text-body-sm">
      <div className="flex min-w-0 flex-col leading-[1.35]">
        <p className="text-caption font-bold text-primary-strong">{label}</p>
        {children}
      </div>
      <button type="button" onClick={onEdit} className="h-9 shrink-0 self-center rounded-pill bg-surface-tint px-3 text-label font-bold text-primary-strong">Edit<span className="sr-only"> {name}</span></button>
    </section>
  );
}

/** Step 3: everything once more, with the server's total, before money moves. Placing the order accepts the terms. */
export function ReviewStep({ quote, busy, details, deliveryMethod, paymentMethod, onEdit }: Props) {
  const phone = normaliseNigerianPhone(details.phone);
  const address = [details.addressLine1, details.area, details.city, details.state].map((s) => s.trim()).filter(Boolean).join(", ");
  return (
    <div className="flex flex-col gap-3">
      <h2 data-step-heading tabIndex={-1} className="font-display text-heading-md font-extrabold outline-none">Quick check</h2>

      <ul aria-label="Items" className="flex flex-col gap-2.5 rounded-lg bg-surface-tint p-3.5">
        {quote?.lines.map((l) => (
          <li key={`${l.gift ? "gift-" : ""}${l.variantId}`} className="flex items-center gap-2.5 text-body-sm">
            <Media image={l.image} alt="" aspect="44 / 52" sizes="44px" className="w-11 shrink-0 rounded-sm" />
            <div className="flex min-w-0 flex-1 flex-col leading-[1.3]">
              <p className="line-clamp-2 font-semibold">{l.title}{l.gift ? <span className="ml-1.5 rounded-pill bg-surface-blush px-2 py-0.5 text-micro font-extrabold uppercase text-primary-strong">Free gift</span> : null}</p>
              <p className="text-caption text-muted">{[l.optionSummary, `Qty ${l.quantity}`].filter(Boolean).join(" · ")}</p>
            </div>
            <p className="font-bold">{l.gift ? "Free" : formatNaira(l.lineTotalMinor)}</p>
          </li>
        ))}
      </ul>

      <EditRow label="Delivery" name="delivery" onEdit={() => onEdit("delivery")}>
        <p>{DELIVERY_LABEL[deliveryMethod]}{quote?.delivery?.estimate ? ` · ${formatEstimate(quote.delivery.estimate)}` : ""}</p>
        <p className="text-ink-soft">{details.name.trim()}, {address}</p>
        <p className="text-ink-soft">{phone ? formatPhone(phone) : details.phone}</p>
      </EditRow>
      <EditRow label="Payment" name="payment" onEdit={() => onEdit("payment")}>
        <p>{PAYMENT_LABEL[paymentMethod]}</p>
      </EditRow>

      {quote ? <PriceSummary quote={quote} busy={busy} bordered /> : null}

      <p className="text-caption text-muted">
        By placing your order you agree to our <Link href="/pages/terms" className="text-primary-strong underline">Terms</Link> and <Link href="/pages/returns" className="text-primary-strong underline">7-day returns policy</Link>.
      </p>
    </div>
  );
}
