"use client";

import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { useState } from "react";
import { getDeliveryQuote } from "@/lib/api/pricing";
import type { DeliveryOption } from "@/lib/api/types";
import { formatDay } from "@/lib/format";
import { NIGERIAN_STATES } from "@/lib/geo/states";

/** Delivery options for one wig to a state. Shared by the estimate card and the badges above the title. */
export function useDeliveryOptions(variantId: string | undefined, state: string) {
  return useQuery({
    queryKey: ["delivery-estimate", variantId, state],
    queryFn: ({ signal }) => getDeliveryQuote({ items: [{ variantId: variantId!, quantity: 1 }], promotionCodes: [], deliveryAddress: { state } }, { signal }),
    enabled: !!variantId,
    staleTime: 5 * 60_000,
  });
}

/** The soonest delivery that can be had: the available option (not pickup) with the earliest date. */
export function soonest(options: DeliveryOption[]): DeliveryOption | undefined {
  return options
    .filter((o) => o.available && o.method !== "pickup" && o.estimate)
    .sort((a, b) => a.estimate!.earliestDate.localeCompare(b.estimate!.earliestDate))[0];
}

type Props = { variantId: string | undefined; state: string; onState: (state: string) => void };

/** "Get it Tue 21 Oct in Lagos." with a Change link that reveals the state picker. */
export function DeliveryEstimate({ variantId, state, onState }: Props) {
  const [changing, setChanging] = useState(false);
  const { data, isFetching, isError } = useDeliveryOptions(variantId, state);
  const best = soonest(data?.options ?? []);

  return (
    <section aria-label="Delivery" className="flex flex-col gap-3 rounded-lg border-[1.5px] border-dashed border-line-accent p-3.5">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-surface-tint text-primary"><Truck size={20} strokeWidth={1.9} /></span>
        <p aria-live="polite" aria-busy={isFetching} className="flex-1 text-body-sm leading-[1.35]">
          {!variantId ? "Choose your options to see delivery times." : isError ? "We couldn't check delivery for this state." : best ? (
            <>Get it <strong>{formatDay(best.estimate!.earliestDate)}</strong> in <strong>{state}</strong>.</>
          ) : isFetching ? "Checking delivery…" : <>We don&apos;t deliver to <strong>{state}</strong> yet.</>}
        </p>
        <button type="button" onClick={() => setChanging((c) => !c)} aria-expanded={changing} className="text-label font-bold text-primary-strong">Change</button>
      </div>
      {changing ? (
        <label className="flex items-center gap-3 text-body-sm">
          <span className="font-semibold">Deliver to</span>
          <select value={state} onChange={(e) => onState(e.target.value)} className="h-10 flex-1 rounded-pill border-[1.5px] border-line-strong bg-surface px-3 text-body-sm">
            {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      ) : null}
    </section>
  );
}
