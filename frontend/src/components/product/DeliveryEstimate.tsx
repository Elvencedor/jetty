"use client";

import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { useState } from "react";
import { getDeliveryQuote } from "@/lib/api/pricing";
import { formatEstimate, formatNaira } from "@/lib/format";
import { NIGERIAN_STATES } from "@/lib/geo/states";

const LABELS = { same_day: "Same-day", next_day: "Next-day", nationwide: "Standard", pickup: "Pickup" } as const;

/** "When will it arrive?" for a chosen state, from the delivery quote for this one wig. */
export function DeliveryEstimate({ variantId }: { variantId: string | undefined }) {
  const [state, setState] = useState("Lagos");
  const { data, isFetching, isError } = useQuery({
    queryKey: ["delivery-estimate", variantId, state],
    queryFn: ({ signal }) => getDeliveryQuote({ items: [{ variantId: variantId!, quantity: 1 }], promotionCodes: [], deliveryAddress: { state } }, { signal }),
    enabled: !!variantId,
    staleTime: 5 * 60_000,
  });
  const options = (data?.options ?? []).filter((o) => o.available && o.method !== "pickup");

  return (
    <section aria-labelledby="delivery-heading" className="flex flex-col gap-3 rounded-card bg-surface-subtle p-4">
      <h2 id="delivery-heading" className="flex items-center gap-2 text-body font-bold"><Truck aria-hidden="true" size={18} /> Delivery</h2>
      <label className="flex items-center gap-3 text-body-sm">
        <span className="font-semibold">Deliver to</span>
        <select value={state} onChange={(e) => setState(e.target.value)} className="h-10 flex-1 rounded-pill border border-line-strong bg-surface px-3 text-body-sm">
          {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <div aria-live="polite" aria-busy={isFetching} className="text-body-sm text-ink-soft">
        {!variantId ? "Choose your options to see delivery times." : isError ? "We couldn't check delivery for this state." : options.length ? (
          <ul className="flex flex-col gap-1">
            {options.map((o) => (
              <li key={o.method}><span className="font-semibold">{LABELS[o.method]}</span>: {o.estimate ? formatEstimate(o.estimate) : "estimate unavailable"} · {o.feeMinor === 0 ? "Free" : formatNaira(o.feeMinor)}</li>
            ))}
          </ul>
        ) : isFetching ? "Checking…" : "Not available for this state yet."}
      </div>
    </section>
  );
}
